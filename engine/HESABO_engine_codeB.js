/* ===================================================================
   HESABO — Code node B: "HESABO Engine"
   RBAC + flows + business logic + approvals. Produces items tagged
   _kind = "msg" | "append:<Sheet>" | "upsert:<Sheet>" for the Switch.
   =================================================================== */
const T0 = Date.now();
const rows = makeRowsReader($);
const upd = $('Telegram Trigger').first().json;
const msg = upd.message || upd.edited_message || {};
const raw = S_(msg.text || msg.caption || '');
const chatId = S_(msg.chat && msg.chat.id);
const cfg = (() => { try { return $('Config').first().json; } catch(e){ return {}; } })();
const db = loadDB({ Settings: rows('Read Settings'), Users: rows('Read Users'), Customers: rows('Read Customers'), Products: rows('Read Products'), Invoices: rows('Read Invoices'), Payments: rows('Read Payments'), Quotations: rows('Read Quotations'), Leads: rows('Read Leads'), Orders: rows('Read Orders'), Approvals: rows('Read Approvals'), Conversations: rows('Read Conversations'), Handoffs: rows('Read Handoffs') });

/* ---- AI answer (if the Gemini node ran) ---- */
let ai = null, aiError = '', aiTried = false;
try { const g = $('Gemini').first().json; aiTried = true;
  if (g && g.candidates && g.candidates[0]){ let t = (g.candidates[0].content.parts||[]).map(p=>p.text||'').join(''); t = t.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim(); const s = t.indexOf('{'), e = t.lastIndexOf('}'); ai = JSON.parse(t.slice(s, e+1)); }
  else aiError = g && g.error ? (g.error.message || JSON.stringify(g.error)).slice(0,120) : 'no candidates';
} catch(e){ if (aiTried) aiError = String(e.message||e).slice(0,120); }

/* ---- output collectors ---- */
const OUT = []; const NOTES = [];
const toHTML = t => esc(t).replace(/\*([^*\n]+)\*/g,'<b>$1</b>');
const send = (chat, text) => { if (!chat) return; OUT.push({ _kind:'msg', chat_id:String(chat), text: toHTML(text) }); };
const append = (sheet, row) => OUT.push(Object.assign({ _kind:'append:'+sheet }, row));
const upsert = (sheet, row) => OUT.push(Object.assign({ _kind:'upsert:'+sheet }, row));
const usersByRole = role => db.users.filter(u => u.role===role);
function notifyRole(role, text, label){ const us = usersByRole(role).filter(u => u.telegram_id); if (!us.length) { NOTES.push(`لا يوجد ${ROLE_AR[role]} مرتبط بتليجرام — الإشعار (${label||''}) لم يُرسل`); return 0; } us.forEach(u => send(u.telegram_id, text)); return us.length; }
function notifyUser(userId, text){ const u = byId(db.users, userId); if (u && u.telegram_id){ send(u.telegram_id, text); return true; } NOTES.push(`${u?u.name:userId} غير مرتبط بتليجرام — لم يصله الإشعار`); return false; }
function notifyCustomer(cust, text){ if (cust && cust.telegram_id){ send(cust.telegram_id, text); return true; } if (cust) NOTES.push(`${cust.company} غير مرتبط بتليجرام — لم يصله الإشعار`); return false; }
const money = n => fmtN(n,0)+' '+db.settings.currency;

/* ---- identity ---- */
const actor = resolveActor(db, chatId, msg.from);
const conv = actor.conv || { id:chatId, phone:'', role:'', name:'', context:null, history:[] };
let ctx = conv.context && conv.context.flow ? conv.context : null;
const history = Array.isArray(conv.history) ? conv.history : [];
const greet = a => a.role==='customer' ? `أهلاً أستاذ ${firstName(a.name)} 👋` : STAFF(a.role) ? `أهلاً ${firstName(a.name)} 👋` : 'أهلاً بك 👋';
let intent = '', engine = 'rules', confidence = 0, success = true, denied = false, handoffMade = false; let reply = ''; let linkedPhone = conv.phone || actor.phone || '';

/* =================== commands & linking =================== */
function linkPhone(phone){
  const p = normPhone(phone); if (!p) return `الرقم مش واضح. اكتبه بالشكل ده: +966501234567`;
  const u = db.users.find(x=>x.phone===p); const c = db.customers.find(x=>x.phone===p);
  if (!u && !c) return `الرقم ${p} مش مسجل عندنا كعميل ولا موظف.\nلو محتاج خدمة اكتب "عايز عرض سعر" وهنسجلك كعميل جديد، أو تواصل مع الحسابات لربط رقمك.`;
  if (u){ upsert('Users', { id:u.id, telegram_id:chatId, telegram_name: actor.tgName||'' }); linkedPhone = p; actor.role=u.role; actor.name=u.name; actor.id=u.id; actor.phone=p; actor.user=u; delete actor.customer; return `تم ربط حسابك ✅\n*${u.name}* — ${u.title} (${ROLE_AR[u.role]})\nاكتب "مساعدة" تشوف اللي تقدر تعمله.`; }
  upsert('Customers', { id:c.id, telegram_id:chatId }); linkedPhone = p; actor.role='customer'; actor.name=c.name; actor.id=c.id; actor.phone=p; actor.customer=c; delete actor.user;
  return `تم ربط حسابك ✅\n*${c.company}* — ${c.name}\nدلوقتي تقدر تسأل: "عليا كام؟" أو "هات آخر فاتورة".`;
}
const cmd = raw.trim().match(/^\/(\w+)(?:@\w+)?\s*(.*)$/);
if (!raw.trim() && !msg.contact){ intent='UNSUPPORTED'; reply = 'أقدر أتعامل مع الرسائل النصية بس حالياً 🙏 (الصوت والصور في مرحلة لاحقة).'; success=false; }
else if (msg.contact){ intent='LINK'; reply = linkPhone(msg.contact.phone_number); }
else if (cmd){
  const c = cmd[1].toLowerCase(), arg = cmd[2];
  if (c==='start'){ intent='START'; reply = `${greet(actor)}\nأنا *${db.settings.botName}* — المساعد الذكي لـ${db.settings.companyName}.\n${actor.linked ? `حسابك مرتبط بـ *${actor.name}* (${ROLE_AR[actor.role]}). اكتب طلبك مباشرة، مثلاً: "عليا كام؟"` : 'عشان أقدر أخدمك، ابعت رقم جوالك المسجل عندنا بالشكل ده:\n+966501234567\n\n(للتجربة: أرقام العملاء والموظفين موجودة في شيت Customers و Users)'}`; }
  else if (c==='link'){ intent='LINK'; reply = arg ? linkPhone(arg) : 'اكتب الرقم بعد الأمر: /link +966501234567'; }
  else if (c==='unlink'){ intent='UNLINK'; if (actor.user) upsert('Users',{id:actor.user.id, telegram_id:''}); if (actor.customer) upsert('Customers',{id:actor.customer.id, telegram_id:''}); linkedPhone=''; ctx=null; reply='تم فك الربط. ابعت رقم تاني عشان تجرب دور مختلف.'; actor.role='unknown'; actor.name=actor.tgName||'—'; actor.id=null; actor.phone=''; delete actor.user; delete actor.customer; }
  else if (c==='whoami'){ intent='WHOAMI'; reply = actor.linked ? `أنت *${actor.name}* — ${ROLE_AR[actor.role]}${actor.customer?' — '+actor.customer.company:''}\nchat_id: ${chatId}` : `حسابك مش مرتبط. chat_id: ${chatId}\nابعت رقم جوالك المسجل عشان نربطه.`; }
  else if (c==='reset'){ intent='RESET'; ctx=null; reply='تم إلغاء أي طلب شغال. ابدأ من جديد 🙂'; }
  else if (c==='help'){ intent='HELP'; reply = helpText(actor.role); }
  else { intent='UNKNOWN_CMD'; reply='أمر مش معروف. الأوامر: /start /link /unlink /whoami /reset /help'; success=false; }
}
else if (looksLikePhone(raw) && (!actor.linked || /^(true|1|yes)$/i.test(S_(cfg.allowRelink)))){ intent='LINK'; reply = linkPhone(raw); }

/* =================== NLU =================== */
let nlu = null;
if (!intent){
  if (ai){ nlu = mergeAI(db, raw, ai); engine='ai'; }
  else { nlu = ruleNLU(db, raw, ctx); engine = 'rules'; if (aiTried && actor.role === 'admin') NOTES.push('الـAI مش متاح مؤقتاً' + (/503|overload|demand/i.test(aiError) ? ' (ضغط على Gemini)' : /429|quota/i.test(aiError) ? ' (حد الاستخدام المجاني)' : '') + ' — اتردّ بمحرك القواعد'); }
  intent = nlu.intent; confidence = nlu.confidence; nlu.entities._raw = raw;
}

/* =================== help / RBAC =================== */
function helpText(role){
  const L = { customer:['رصيدك الحالي ("عليا كام؟")','آخر فاتورة أو حالة فاتورة برقمها','قائمة فواتيرك المفتوحة وموعد الاستحقاق','مدفوعاتك وتسجيل تحويل جديد','كشف حساب','طلب عرض سعر لأي خدمة ومتابعته'],
    sales:['بيانات عميل أو رصيده الإجمالي','إضافة عميل جديد أو فرصة (Lead)','إنشاء طلب تسعير لعميل','العروض المفتوحة ومتابعة العملاء اللي ما ردوش','تقرير مبيعات الأسبوع / الشهر'],
    accountant:['رصيد أي عميل وكشف حسابه','الفواتير والمدفوعات وحالة أي فاتورة','تسجيل دفعة وإنشاء فاتورة (بموافقة)','مين عليه فلوس / المتأخرين','اعتماد الطلبات: "اعتمد AP-3" أو "ارفض AP-3 السبب" — "الطلبات المعلقة"'],
    admin:['كل صلاحيات المبيعات والمحاسبة','اعتماد عروض الأسعار والفواتير: "اعتمد AP-3"','الرد على التحويلات البشرية: "رد HO-2 النص"','تقارير المبيعات والتحصيل'],
    unknown:['طلب عرض سعر لخدمة (قص / كور / مسح / هدم / ترميم)','لو أنت عميل حالي: ابعت رقم جوالك المسجل عشان نربط حسابك'] }[role] || [];
  return `أقدر أساعدك في:\n${L.map(x=>'• '+x).join('\n')}\n\nاكتب طلبك بشكل طبيعي وأنا هفهمه 🙂`;
}

/* =================== flows =================== */
const FLOWS = {
  CREATE_QUOTATION:{ title:'طلب عرض سعر', slots:a => STAFF(a.role) ? ['customer','service','quantity','location','thickness'] : a.role==='unknown' ? ['person_name','company_text','service','quantity','location','thickness'] : ['service','quantity','location','thickness'] },
  RECORD_PAYMENT:{ title:'تسجيل دفعة', slots:a => STAFF(a.role) ? ['customer','amount','payment_method','invoice_no'] : ['amount','payment_method','invoice_no'] },
  CREATE_INVOICE:{ title:'إنشاء فاتورة', slots:()=>['customer','amount','description'] },
  CREATE_CUSTOMER:{ title:'إضافة عميل', slots:()=>['company_text','person_name','phone'] },
  CREATE_LEAD:{ title:'تسجيل فرصة', slots:()=>['person_name','phone','service','location'] },
  NEED_CUSTOMER:{ title:'تحديد العميل', slots:()=>['customer'] },
  NEED_INVOICE:{ title:'تحديد الفاتورة', slots:()=>['invoice_no'] },
};
const SLOT_Q = { customer:'العميل مين؟ اكتب اسم الشركة أو اسم المسؤول.', service:'الخدمة المطلوبة إيه؟ (قص خرسانة / كور / مسح GPR / هدم / حقن شروخ / تقوية كربون / زرع أشاير / معالجة صدأ)', quantity:'الكمية التقريبية كام؟ (مثال: 20 متر، 50 نقطة، 300 م²)', location:'موقع العمل فين؟ (المدينة أو اسم المشروع)', thickness:'سمك الخرسانة كام سم؟ (لو مش متأكد اكتب "مش عارف")', amount:'المبلغ كام؟', payment_method:'طريقة الدفع؟ (تحويل بنكي / شيك / نقدي)', invoice_no:'رقم الفاتورة؟ (أو اكتب "أقدم فاتورة" عشان نخصمها من أقدم فاتورة مفتوحة)', description:'وصف الفاتورة / الأعمال؟', company_text:'اسم الشركة؟ (لو مفيش اكتب "لا")', person_name:'اسم المسؤول؟', phone:'رقم الجوال؟ (05xxxxxxxx)' };
const slotLabel = s => ({customer:'العميل',service:'الخدمة',quantity:'الكمية',location:'الموقع',thickness:'السمك',amount:'المبلغ',payment_method:'طريقة الدفع',invoice_no:'الفاتورة',description:'الوصف',company_text:'الشركة',person_name:'المسؤول',phone:'الجوال'})[s]||s;
function fmtSlot(s,v){ if (v===null||v===undefined||v==='') return '—'; if (s==='customer') return customerName(db,v); if (s==='service'){ const p=db.productById(v); return p?p.name:v; } if (s==='quantity') return fmtN(v); if (s==='thickness') return v==='unknown'?'غير محدد':v+' سم'; if (s==='amount') return money(v); if (s==='invoice_no') return v==='oldest'?'أقدم فاتورة مفتوحة':'INV-'+v; return String(v); }
function fillSlots(c, rawText, n, a){
  const e = n.entities||{}; const fa = n.flow_answer||{}; const nn = norm(rawText);
  const set = (k,v) => { if (v!==undefined && v!==null && v!=='') c.slots[k]=v; };
  for (const [k,v] of Object.entries(fa)){ if (!c.all.includes(k)) continue;
    if (k==='customer'){ const cc = findCustomerInText(db, norm(String(v))); if (cc) set('customer', cc.id); }
    else if (k==='service'){ const p = matchProduct(db, String(v)); if (p) set('service', p.id); }
    else if (k==='thickness'){ set('thickness', /مش عارف|غير معروف|unknown|لا اعرف|مش متاكد/.test(norm(String(v))) ? 'unknown' : (parseFloat(v)||undefined)); }
    else if (k==='invoice_no'){ set('invoice_no', /اقدم|oldest|اي فاتوره/.test(norm(String(v))) ? 'oldest' : (parseInt(v)||undefined)); }
    else if (k==='quantity'||k==='amount'){ set(k, parseFloat(v)||undefined); }
    else if (k==='phone'){ set('phone', normPhone(v)||undefined); }
    else set(k, String(v)); }
  if (e.customer_id) set('customer', e.customer_id); if (e.service) set('service', e.service); if (e.quantity) set('quantity', e.quantity); if (e.unit) c.unit = e.unit;
  if (e.location) set('location', e.location); else if (e.location_text) set('location', e.location_text);
  if (e.thickness_cm) set('thickness', e.thickness_cm);
  if (e.amount) set('amount', e.amount); else if (c.all.includes('amount') && c.slots.amount===undefined && e.numbers){ const cands = e.numbers.filter(x=>x!==e.invoice_no && x!==e.quotation_no && x!==e.quantity && x!==e.thickness_cm && x>=50); if (cands.length) set('amount', Math.max(...cands)); }
  if (e.payment_method) set('payment_method', e.payment_method); if (e.invoice_no) set('invoice_no', e.invoice_no); if (e.reference) c.reference = e.reference;
  if (e.phone) set('phone', e.phone); if (e.person_name) set('person_name', e.person_name); if (e.company_text) set('company_text', e.company_text);
  const asked = c.asked;
  if (asked && c.slots[asked]===undefined){ const num = (nn.match(/\d+(?:\.\d+)?/)||[])[0];
    if (asked==='quantity' && num) set('quantity', +num); else if (asked==='amount' && num) set('amount', +num);
    else if (asked==='thickness'){ if (/مش عارف|معرفش|غير معروف|unknown|لا اعرف|مش متاكد|مش محدد/.test(nn)) set('thickness','unknown'); else if (num) set('thickness', +num); }
    else if (asked==='invoice_no'){ if (/اقدم|oldest|اي فاتوره|اي واحده/.test(nn)) set('invoice_no','oldest'); else if (num && +num>=100) set('invoice_no', +num); }
    else if (asked==='location' && rawText.trim().length>=2 && !num) set('location', rawText.trim());
    else if (asked==='description' && rawText.trim().length>=2) set('description', rawText.trim());
    else if (asked==='person_name' && rawText.trim().length>=2 && !num) set('person_name', rawText.trim());
    else if (asked==='company_text' && rawText.trim().length>=1){ if (/^(لا|لأ|مفيش|بدون|فرد|شخصي|no)/.test(nn)) set('company_text','—'); else set('company_text', rawText.trim()); }
    else if (asked==='customer'){ const cc = findCustomerInText(db, nn); if (cc) set('customer', cc.id); }
    else if (asked==='service'){ const p = matchProduct(db, nn); if (p) set('service', p.id); }
    else if (asked==='phone'){ const p = normPhone(rawText); if (p) set('phone', p); } }
  if (c.slots.service){ const p = db.productById(c.slots.service); if (p && !['قص','كور','هدم'].includes(p.cat) && c.slots.thickness===undefined) c.slots.thickness='n/a'; }
  c.missing = c.all.filter(k => c.slots[k]===undefined);
}
function startFlow(name, a, seed, rawText){ const f = FLOWS[name]; const all = f.slots(a); const c = { flow:name, all, slots:{}, missing:all.slice(), asked:null, confirming:false, intent:name, startedAt:new Date().toISOString() }; if (seed) fillSlots(c, rawText||'', seed, a); return c; }
function nextQuestion(c){ const k = c.missing[0]; c.asked = k; const done = c.all.filter(s => c.slots[s]!==undefined && c.slots[s]!=='n/a').map(s => `• ${slotLabel(s)}: ${fmtSlot(s,c.slots[s])}`).join('\n'); return (done ? 'تمام، سجلت:\n'+done+'\n\n' : '') + (SLOT_Q[k]||('محتاج '+slotLabel(k)+'؟')); }
function confirmSummary(c){ const lines = c.all.filter(s => c.slots[s]!=='n/a').map(s => `• ${slotLabel(s)}: ${fmtSlot(s,c.slots[s])}${s==='quantity'&&c.unit?' '+c.unit:''}`).join('\n'); return `*ملخص ${FLOWS[c.flow].title}:*\n${lines}\n\nأأكد الطلب؟ (نعم / لا)`; }

/* =================== business helpers (writes) =================== */
function quotationMessage(q, items){ return `📝 *عرض سعر ${q.id}*\n${db.settings.companyName}\nإلى: ${q.customerId?customerName(db,q.customerId):(q.contactName||'—')}\n\n${items.map(x=>`${x.name}\n${fmtN(x.qty)} ${x.unit} × ${fmtN(x.price)} = ${fmtN(x.total)}`).join('\n')}\n\nالإجمالي: ${fmtN(q.subtotal)}\nضريبة القيمة المضافة ${db.settings.vat}%: ${fmtN(q.vat)}\n*الصافي: ${money(q.total)}*\nصالح حتى ${fmtDateAr(q.validUntil)}\n\nللموافقة اكتب "موافق على ${q.id}" أو تواصل مع مندوبك.`; }
function createApproval(type, payload, a, approverRole){ const ap = { id: db.nextId('AP-', db.approvals, 1), type, payload, requestedBy:a.name, requestedByChat:chatId, requesterRole:a.role, approverRole, requestedAt:new Date().toISOString(), status:'pending' }; db.approvals.unshift(ap); append('Approvals', { id:ap.id, type, payload:JSON.stringify(payload), requested_by:a.name, requested_by_chat:chatId, requester_role:a.role, approver_role:approverRole, requested_at:ap.requestedAt, status:'pending', decided_by:'', decided_at:'', note:'', result:'' }); return ap; }
function applyPayment(p, by){ const pay = { id: db.nextId('PAY-', db.payments, 3001), customerId:p.customerId, invoiceId:p.invoiceId||'', date:TODAY, amount:N(p.amount), method:p.method, reference:p.reference||('TG'+Date.now().toString().slice(-6)), recordedBy:by }; db.payments.unshift(pay); append('Payments', { id:pay.id, customer_id:pay.customerId, invoice_id:pay.invoiceId, date:pay.date, amount:pay.amount, method:pay.method, reference:pay.reference, recorded_by:by });
  if (pay.invoiceId){ const inv = byId(db.invoices, pay.invoiceId); if (inv){ const applied = Math.min(inv.remaining, pay.amount); inv.paid += applied; inv.remaining -= applied; upsert('Invoices', { id:inv.id, paid:inv.paid, remaining:inv.remaining, status:invoiceStatus(inv) }); } } return pay; }
function applyInvoice(p, by){ const amount = N(p.amount); const subtotal = Math.round(amount/(1+db.settings.vat/100)); const vat = amount-subtotal; const inv = { id: db.nextId('INV-', db.invoices, 1001), customerId:p.customerId, date:TODAY, dueDate:fmtDate(addDays(NOW,30)), project:p.description||'', items:'', subtotal, vat, amount, paid:0, remaining:amount, status:'unpaid', createdBy:by }; db.invoices.unshift(inv); append('Invoices', { id:inv.id, customer_id:inv.customerId, date:inv.date, due_date:inv.dueDate, project:inv.project, items:'', subtotal, vat, amount, paid:0, remaining:amount, status:'unpaid', created_by:by }); return inv; }
function applyCustomer(p, by){ const c = { id: db.nextId('C-', db.customers, 1).replace(/^C-(\d+)$/, (m,d)=>'C-'+d.padStart(3,'0')), company:p.company, core:S_(p.company).replace(/^(شركة|مؤسسة|شركه|مؤسسه)\s+/,'').split(' ').slice(0,2).join(' '), name:p.name, phone:normPhone(p.phone), vat:'', city:'', creditLimit:50000, status:'active', salesRep:p.salesRep||'U-S1', telegram_id:'' }; db.customers.push(c); append('Customers', { id:c.id, company:c.company, core:c.core, contact_name:c.name, phone:c.phone, vat:'', city:'', credit_limit:50000, status:'active', sales_rep:c.salesRep, created_at:TODAY, telegram_id:'' }); return c; }
function decideApproval(ap, approve, by, note){
  ap.status = approve?'approved':'rejected'; ap.decidedBy = by; ap.decidedAt = new Date().toISOString(); ap.note = note||''; const p = ap.payload||{}; let result = '';
  if (approve){
    if (ap.type==='RECORD_PAYMENT'){ const pay = applyPayment(p, by); result = pay.id; const c = byId(db.customers,p.customerId); notifyCustomer(c, `✅ تم ترحيل دفعتك *${pay.id}*\n${money(pay.amount)} — ${pay.method}${pay.invoiceId?' — على الفاتورة '+pay.invoiceId:''}\nشكراً لسدادكم 🙏`); if (ap.requestedByChat && (!c || c.telegram_id!==ap.requestedByChat)) send(ap.requestedByChat, `✅ تم اعتماد طلبك ${ap.id} — الدفعة ${pay.id} اتسجلت.`); }
    else if (ap.type==='CREATE_INVOICE'){ const inv = applyInvoice(p, by); result = inv.id; const c = byId(db.customers,p.customerId); notifyCustomer(c, `📄 تم إصدار فاتورة جديدة *${inv.id}* على حسابكم بقيمة ${money(inv.amount)}\n${inv.project}\nالاستحقاق: ${fmtDateAr(inv.dueDate)}`); if (ap.requestedByChat) send(ap.requestedByChat, `✅ تم اعتماد الفاتورة ${inv.id} (${ap.id}) بواسطة ${by}.`); }
    else if (ap.type==='CREATE_CUSTOMER'){ const c = applyCustomer(p, by); result = c.id; if (ap.requestedByChat) send(ap.requestedByChat, `✅ تم اعتماد إضافة العميل ${c.company} — ${c.id}`); }
    else if (ap.type==='SEND_QUOTATION'){ const q = byId(db.quotations, p.quotationId); if (q){ q.status='sent'; q.date=TODAY; q.validUntil=fmtDate(addDays(NOW,15)); result=q.id; upsert('Quotations', { id:q.id, status:'sent', date:q.date, valid_until:q.validUntil }); const items = db.expandItems(q.items); const text = quotationMessage(Object.assign({contactName:p.customer}, q), items); if (p.contactChat) send(p.contactChat, text); else { const c = byId(db.customers, q.customerId); notifyCustomer(c, text); } } }
  } else {
    if (ap.type==='SEND_QUOTATION'){ const q = byId(db.quotations, p.quotationId); if (q){ q.status='rejected'; upsert('Quotations', { id:q.id, status:'rejected' }); } }
    if (ap.requestedByChat) send(ap.requestedByChat, `❌ تم رفض الطلب ${ap.id}${note?' — السبب: '+note:''}`);
  }
  upsert('Approvals', { id:ap.id, status:ap.status, decided_by:by, decided_at:ap.decidedAt, note:ap.note, result });
  return result;
}
function executeFlow(c, a){
  const s = c.slots; const needs = t => !!db.settings.approvals[t];
  if (c.flow==='CREATE_QUOTATION'){
    let customer = s.customer ? byId(db.customers, s.customer) : a.customer; let leadId = ''; const p = db.productById(s.service); const qty = N(s.quantity);
    if (!customer){ const lead = { id: db.nextId('LD-', db.leads, 401) }; db.leads.unshift(lead); leadId = lead.id; append('Leads', { id:lead.id, date:TODAY, name:s.person_name||a.tgName||'—', phone:a.phone||'', company:s.company_text==='—'?'':(s.company_text||''), service:p.id, service_name:p.name, location:s.location||'', qty, unit:c.unit||p.unit, thickness:(s.thickness&&s.thickness!=='unknown'&&s.thickness!=='n/a')?s.thickness+' سم':'', status:'new', source:'telegram', assigned_to:'U-S1', telegram_id:chatId }); }
    const items = [{ productId:p.id, name:p.name, unit:p.unit, qty, price:p.price, total:qty*p.price }]; const subtotal = sum(items,x=>x.total), vat = Math.round(subtotal*db.settings.vat/100);
    const q = { id: db.nextId('QT-', db.quotations, 2001), customerId: customer?customer.id:'', leadId, contactPhone:a.phone||'', date:TODAY, validUntil:fmtDate(addDays(NOW,15)), items:`${p.id}x${qty}`, subtotal, vat, total:subtotal+vat, status: needs('SEND_QUOTATION')?'pending_approval':'sent', location:s.location||'', thickness:(s.thickness&&s.thickness!=='unknown'&&s.thickness!=='n/a')?s.thickness+' سم':'', notes:`طلب عبر تليجرام من ${a.name}`, requestedVia:'telegram', salesRep: customer?customer.salesRep:'U-S1', followUps:0 };
    db.quotations.unshift(q); append('Quotations', { id:q.id, customer_id:q.customerId, lead_id:leadId, contact_phone:q.contactPhone, date:q.date, valid_until:q.validUntil, items:q.items, subtotal, vat, total:q.total, status:q.status, location:q.location, thickness:q.thickness, notes:q.notes, requested_via:'telegram', sales_rep:q.salesRep, follow_ups:0, last_follow_up:'' });
    const who = customer ? customer.company : `${s.person_name||a.tgName||''} (عميل جديد — ${leadId})`;
    notifyUser(q.salesRep, `🔔 طلب تسعير جديد *${q.id}*\nمن: ${who}\n${p.name}: ${fmtN(qty)} ${p.unit}${s.location?' — '+s.location:''}${q.thickness?' — سمك '+q.thickness:''}\nالتسعير المبدئي: ${money(q.total)}`);
    if (q.status==='pending_approval'){ const ap = createApproval('SEND_QUOTATION', { quotationId:q.id, customer:who, total:q.total, summary:`${p.name} × ${fmtN(qty)} ${p.unit}`, contactChat:chatId }, a, 'admin'); notifyRole('admin', `🔔 عرض سعر *${q.id}* بانتظار اعتمادك (${ap.id})\n${who} — ${p.name} × ${fmtN(qty)} — ${money(q.total)}\n\nللاعتماد اكتب: اعتمد ${ap.id}\nللرفض اكتب: ارفض ${ap.id} السبب`, ap.id);
      return `تم تسجيل طلبك ✅\nرقم الطلب: *${q.id}*\n${p.name}: ${fmtN(qty)} ${p.unit}${s.location?'\nالموقع: '+s.location:''}\n\nعرض السعر بيتراجع من قسم التسعير وهيوصلك هنا بمجرد اعتماده 📎`; }
    return quotationMessage(Object.assign({contactName: s.person_name||''}, q), items);
  }
  if (c.flow==='RECORD_PAYMENT'){
    const customer = s.customer ? byId(db.customers, s.customer) : a.customer; let inv = null;
    if (s.invoice_no && s.invoice_no!=='oldest') inv = db.invoices.find(i=>i.id==='INV-'+s.invoice_no);
    if (!inv) inv = customerInvoices(db, customer.id).filter(i=>i.remaining>0).sort((x,y)=> x.dueDate<y.dueDate?-1:1)[0] || null;
    if (inv && inv.customerId!==customer.id){ delete c.slots.invoice_no; c.confirming=false; c.missing=['invoice_no']; c.asked='invoice_no'; return { reopen:true, text:`الفاتورة ${inv.id} مش على حساب ${customer.company} 🔒\nابعت رقم فاتورة صحيح، أو اكتب "أقدم فاتورة".` }; }
    const payload = { customerId:customer.id, customer:customer.company, amount:N(s.amount), method:s.payment_method, invoiceId: inv?inv.id:'', reference:c.reference||'', reportedBy:a.name };
    if (needs('RECORD_PAYMENT')){ const role = a.role==='accountant'?'admin':'accountant'; const ap = createApproval('RECORD_PAYMENT', payload, a, role); notifyRole(role, `🔔 طلب تسجيل دفعة *${ap.id}*\n${customer.company}: ${money(payload.amount)} — ${payload.method}${inv?' — '+inv.id:''}\nمن: ${a.name}\n\nللاعتماد اكتب: اعتمد ${ap.id}`, ap.id);
      return `تم استلام بيانات الدفعة ✅\nالعميل: ${customer.company}\nالمبلغ: ${money(payload.amount)} — ${payload.method}${inv?'\nالفاتورة: '+inv.id:''}\n\nالدفعة *بانتظار مراجعة ${ROLE_AR[role]}* (${ap.id}) وهنبلغك بمجرد ترحيلها.`; }
    const pay = applyPayment(payload, a.name); return `تم ترحيل الدفعة ✅ *${pay.id}*\n${money(pay.amount)} — ${pay.method}${pay.invoiceId?' — على '+pay.invoiceId:''}`;
  }
  if (c.flow==='CREATE_INVOICE'){
    const customer = byId(db.customers, s.customer); const payload = { customerId:customer.id, customer:customer.company, amount:N(s.amount), description:s.description, requestedBy:a.name };
    if (needs('CREATE_INVOICE') || payload.amount >= db.settings.approvalThreshold){ const role = a.role==='accountant'?'admin':'accountant'; const ap = createApproval('CREATE_INVOICE', payload, a, role); notifyRole(role, `🔔 مسودة فاتورة *${ap.id}* تحتاج اعتمادك\n${customer.company} — ${money(payload.amount)}\n${s.description}\nمن: ${a.name}\n\nللاعتماد اكتب: اعتمد ${ap.id}`, ap.id);
      return `تم إنشاء *مسودة فاتورة* لـ ${customer.company} بقيمة ${money(payload.amount)} (${ap.id}).\nالفاتورة مش هتصدر غير بعد اعتماد ${ROLE_AR[role]} ✋`; }
    const inv = applyInvoice(payload, a.name); return `تم إصدار الفاتورة ✅ *${inv.id}* لـ ${customer.company} بقيمة ${money(inv.amount)}`;
  }
  if (c.flow==='CREATE_CUSTOMER'){
    const payload = { company:s.company_text, name:s.person_name, phone:s.phone, salesRep: a.role==='sales'?a.id:'U-S1', requestedBy:a.name };
    if (needs('CREATE_CUSTOMER')){ const ap = createApproval('CREATE_CUSTOMER', payload, a, 'admin'); notifyRole('admin', `🔔 طلب إضافة عميل *${ap.id}*: ${payload.company} — ${payload.name} — ${payload.phone}\nمن: ${a.name}\nللاعتماد اكتب: اعتمد ${ap.id}`, ap.id); return `تم تسجيل طلب إضافة العميل *${s.company_text}* (${ap.id}) وبانتظار اعتماد المدير.`; }
    const cu = applyCustomer(payload, a.name); return `تم إضافة العميل ✅\n*${cu.company}* — ${cu.id}\nالمسؤول: ${cu.name} — ${cu.phone}\nلما يبعت رقمه للبوت هيتربط تلقائياً كعميل.`;
  }
  if (c.flow==='CREATE_LEAD'){ const p = db.productById(s.service); const lead = { id: db.nextId('LD-', db.leads, 401) }; db.leads.unshift(lead); append('Leads', { id:lead.id, date:TODAY, name:s.person_name, phone:normPhone(s.phone)||S_(s.phone), company:'', service:p.id, service_name:p.name, location:s.location||'', qty:'', unit:p.unit, thickness:'', status:'new', source:'telegram', assigned_to: a.role==='sales'?a.id:'U-S1', telegram_id:'' }); return `تم تسجيل الفرصة ✅ *${lead.id}*\n${s.person_name} — ${s.phone}\n${p.name} — ${s.location||''}`; }
  return 'تم.';
}

/* =================== read handlers =================== */
const H = {};
function needCustomer(a,e){ if (e.customer_id) return byId(db.customers, e.customer_id); if (a.role==='customer') return a.customer; return null; }
const invLine = i => { const st = invoiceStatus(i); return `• ${i.id} — ${fmtDateAr(i.date)} — ${money(i.amount)} — ${STATUS_AR[st]}${i.remaining>0?` (متبقي ${money(i.remaining)})`:''}`; };
H.GREETING = a => ({ reply:`${greet(a)}\nأنا *${db.settings.botName}* — المساعد الذكي لـ${db.settings.companyName}.\n${a.role==='unknown'?'حسابك مش مرتبط — ابعت رقم جوالك المسجل، أو اكتب "عايز عرض سعر".':'اكتب طلبك مباشرة، مثلاً: "عليا كام؟" أو "هات آخر فاتورة".'}` });
H.THANKS = () => ({ reply:'العفو 🌹 تحت أمرك في أي وقت.' });
H.HELP = a => ({ reply: helpText(a.role) });
H.CUSTOMER_BALANCE = (a,e) => { const c = needCustomer(a,e); if (!c) return { askCustomer:true }; const b = customerBalance(db,c.id); if (a.role==='sales') return { reply:`*${c.company}*\nالرصيد المستحق: ${money(b.remaining)}${b.overdue>0?` (متأخر: ${money(b.overdue)})`:''}\nحد الائتمان: ${money(c.creditLimit)}` }; let t = `${a.role==='customer'?greet(a):'*'+c.company+'*'}\nإجمالي الفواتير: ${money(b.total)}\nالمدفوع: ${money(b.paid)}\n*المتبقي: ${money(b.remaining)}*`; if (b.overdue>0) t += `\n⚠️ منها متأخر عن الاستحقاق: ${money(b.overdue)}`; return { reply:t }; };
H.LAST_INVOICE = (a,e) => { const c = needCustomer(a,e); if (!c) return { askCustomer:true }; if (a.role==='sales') return { reply:'تفاصيل الفواتير من صلاحيات المحاسبة. تقدر تطلب الرصيد الإجمالي للعميل بس.', denied:true }; const inv = customerInvoices(db,c.id).slice().sort((x,y)=>x.date<y.date?1:-1)[0]; if (!inv) return { reply:`مفيش فواتير مسجلة على ${c.company} لحد دلوقتي.` }; const items = db.expandItems(inv.items); const st = invoiceStatus(inv); return { reply:`آخر فاتورة على *${c.company}*:\n📄 *${inv.id}* — ${fmtDateAr(inv.date)}\nالمشروع: ${inv.project}\n${items.length?'البنود:\n'+items.map(x=>`  - ${x.name}: ${fmtN(x.qty)} ${x.unit} × ${fmtN(x.price)}`).join('\n')+'\n':''}الإجمالي شامل الضريبة: *${money(inv.amount)}*\nالمدفوع: ${money(inv.paid)} — المتبقي: ${money(inv.remaining)}\nالحالة: ${STATUS_AR[st]} — الاستحقاق ${fmtDateAr(inv.dueDate)}\n📎 ${inv.id}.pdf (يُرفق في نسخة الإنتاج)` }; };
function findInvoice(a,e){ if (!e.invoice_no) return { ask:true }; const inv = db.invoices.find(i=>i.id==='INV-'+e.invoice_no); if (!inv) return { reply:`مش لاقي فاتورة برقم ${e.invoice_no}. اتأكد من الرقم وابعته تاني.` }; if (a.role==='customer' && inv.customerId!==a.customer.id) return { reply:`الفاتورة ${inv.id} مش مسجلة على حسابك، فمش هقدر أعرض تفاصيلها 🔒`, denied:true }; if (a.role==='sales') return { reply:'تفاصيل الفواتير من صلاحيات المحاسبة.', denied:true }; return { inv }; }
H.INVOICE_STATUS = (a,e) => { const r = findInvoice(a,e); if (r.ask) return { askInvoice:true }; if (!r.inv) return r; const inv = r.inv, st = invoiceStatus(inv); const pays = db.payments.filter(p=>p.invoiceId===inv.id); let t = `📄 *${inv.id}* — ${customerName(db,inv.customerId)}\nالقيمة: ${money(inv.amount)}\nالحالة: *${STATUS_AR[st]}*`; if (pays.length) t += `\nالمدفوعات:\n${pays.map(p=>`  - ${fmtDateAr(p.date)}: ${money(p.amount)} (${p.method})`).join('\n')}`; t += inv.remaining>0 ? `\nالمتبقي: ${money(inv.remaining)} — الاستحقاق ${fmtDateAr(inv.dueDate)}${st==='overdue'?` (متأخرة ${daysBetween(inv.dueDate,NOW)} يوم)`:''}` : '\n✅ مسددة بالكامل'; return { reply:t }; };
H.INVOICE_DUE_DATE = (a,e) => { if (!e.invoice_no && a.role==='customer'){ const open = customerInvoices(db,a.customer.id).filter(i=>i.remaining>0).sort((x,y)=>x.dueDate<y.dueDate?-1:1); if (!open.length) return { reply:'مفيش فواتير مفتوحة على حسابك 🎉' }; return { reply:`مواعيد استحقاق فواتيرك المفتوحة:\n${open.slice(0,6).map(i=>`• ${i.id}: ${fmtDateAr(i.dueDate)} — متبقي ${money(i.remaining)}${i.dueDate<TODAY?' ⚠️ متأخرة':''}`).join('\n')}` }; } const r = findInvoice(a,e); if (r.ask) return { askInvoice:true }; if (!r.inv) return r; const inv = r.inv; const d = daysBetween(NOW, inv.dueDate); return { reply:`📄 ${inv.id} — تاريخ الاستحقاق: *${fmtDateAr(inv.dueDate)}*\n${inv.remaining<=0?'✅ الفاتورة مسددة بالكامل.': d>=0?`باقي ${d} يوم على الاستحقاق. المتبقي ${money(inv.remaining)}.`:`⚠️ متأخرة ${-d} يوم. المتبقي ${money(inv.remaining)}.`}` }; };
H.LIST_INVOICES = (a,e) => { const c = needCustomer(a,e); if (!c) return { askCustomer:true }; if (a.role==='sales') return { reply:'قائمة الفواتير من صلاحيات المحاسبة. تقدر تطلب الرصيد الإجمالي للعميل.', denied:true }; let list = customerInvoices(db,c.id).sort((x,y)=>x.date<y.date?1:-1); const openOnly = e.invoice_filter==='open' || /مفتوح|غير مدفوع|مش مدفوع|متبقي|المستحقه|اللي عليا/.test(norm(e._raw||'')); if (openOnly) list = list.filter(i=>i.remaining>0); if (!list.length) return { reply: openOnly?`مفيش فواتير مفتوحة على ${c.company} 🎉`:`مفيش فواتير مسجلة على ${c.company}.` }; const shown = list.slice(0,8); return { reply:`${openOnly?'الفواتير المفتوحة':'آخر الفواتير'} على *${c.company}* (${list.length}):\n${shown.map(invLine).join('\n')}${list.length>8?`\n… و${list.length-8} فاتورة أخرى. اطلب "كشف حساب" للتفاصيل.`:''}\n\n*إجمالي المتبقي: ${money(sum(list,i=>i.remaining))}*` }; };
H.PAYMENT_SEARCH = (a,e) => { const c = needCustomer(a,e); if (!c) return { askCustomer:true }; if (a.role==='sales') return { reply:'المدفوعات من صلاحيات المحاسبة.', denied:true }; const pays = db.payments.filter(p=>p.customerId===c.id).sort((x,y)=>x.date<y.date?1:-1); if (!pays.length) return { reply:`مفيش مدفوعات مسجلة على ${c.company} لحد دلوقتي.` }; return { reply:`آخر مدفوعات *${c.company}*:\n${pays.slice(0,5).map(p=>`• ${fmtDateAr(p.date)} — ${money(p.amount)} — ${p.method} — ${p.invoiceId} (مرجع ${p.reference})`).join('\n')}\n\nإجمالي المدفوع: *${money(sum(pays,p=>p.amount))}*` }; };
H.STATEMENT = (a,e) => { const c = needCustomer(a,e); if (!c) return { askCustomer:true }; if (a.role==='sales') return { reply:'كشف الحساب من صلاحيات المحاسبة.', denied:true }; const rws = []; customerInvoices(db,c.id).forEach(i=>rws.push({d:i.date,doc:i.id,debit:i.amount,credit:0})); db.payments.filter(p=>p.customerId===c.id).forEach(p=>rws.push({d:p.date,doc:p.id,debit:0,credit:p.amount})); rws.sort((x,y)=>x.d<y.d?-1:1); let bal=0; rws.forEach(r=>{bal+=r.debit-r.credit; r.bal=bal;}); const last = rws.slice(-8); return { reply:`📑 *كشف حساب ${c.company}*\nحتى ${fmtDateAr(NOW)}\n\n${last.map(r=>`${r.d} | ${r.doc} | ${r.debit?'مدين '+fmtN(r.debit):'دائن '+fmtN(r.credit)} | رصيد ${fmtN(r.bal)}`).join('\n')}\n\n*الرصيد النهائي: ${money(bal)}*\n(آخر 8 حركات — الكشف الكامل PDF في نسخة الإنتاج)` }; };
H.QUOTATION_STATUS = (a,e) => { let q = null; if (e.quotation_no) q = db.quotations.find(x=>x.id==='QT-'+e.quotation_no); else if (a.role==='customer') q = db.quotations.filter(x=>x.customerId===a.customer.id).sort((x,y)=>x.date<y.date?1:-1)[0]; else if (e.customer_id) q = db.quotations.filter(x=>x.customerId===e.customer_id).sort((x,y)=>x.date<y.date?1:-1)[0]; if (!q) return { reply: e.quotation_no?`مش لاقي عرض سعر برقم ${e.quotation_no}.`:'مش لاقي عروض أسعار على حسابك. تحب تطلب عرض سعر جديد؟' }; if (a.role==='customer' && q.customerId!==a.customer.id) return { reply:`عرض السعر ${q.id} مش مسجل على حسابك 🔒`, denied:true }; const items = db.expandItems(q.items); const stMsg = { draft:'لسه بيتجهز', pending_approval:'بانتظار اعتماد التسعير — هيوصلك خلال وقت قصير', sent:'مرسل ومنتظرين ردكم', accepted:'مقبول ✅ وتم فتح أمر شغل', rejected:'مرفوض', expired:'انتهت صلاحيته — نقدر نجدده لو تحب' }[q.status]||q.status; return { reply:`📝 *${q.id}* — ${q.customerId?customerName(db,q.customerId):'عميل جديد'}\n${items.map(x=>`${x.name}: ${fmtN(x.qty)} ${x.unit}`).join('\n')}\nالإجمالي: ${q.status==='pending_approval'||q.status==='draft'?'(بعد الاعتماد)':money(q.total)}\nالحالة: *${STATUS_AR[q.status]||q.status}* — ${stMsg}\nصالح حتى ${fmtDateAr(q.validUntil)}` }; };
H.OPEN_QUOTATIONS = () => { const list = db.quotations.filter(q=>q.status==='sent'||q.status==='pending_approval').sort((x,y)=>x.date<y.date?1:-1); if (!list.length) return { reply:'مفيش عروض أسعار مفتوحة حالياً.' }; return { reply:`عروض الأسعار المفتوحة (${list.length}):\n${list.slice(0,10).map(q=>`• ${q.id} — ${q.customerId?customerName(db,q.customerId):'عميل جديد'} — ${money(q.total)} — ${STATUS_AR[q.status]} — من ${daysBetween(q.date,NOW)} يوم`).join('\n')}${list.length>10?`\n… و${list.length-10} عرض آخر`:''}\n\nإجمالي القيمة: *${money(sum(list,q=>q.total))}*` }; };
H.FOLLOW_UP = (a) => { const stale = db.quotations.filter(q=>q.status==='sent' && daysBetween(q.date,NOW)>=db.settings.followUpDays); if (!stale.length) return { reply:`كل العروض المرسلة لسه جديدة (أقل من ${db.settings.followUpDays} أيام). مفيش حاجة تحتاج متابعة دلوقتي.` }; const targets = stale.slice(0,8); let sent=0, skipped=0; targets.forEach(q => { const c = byId(db.customers,q.customerId); const items = db.expandItems(q.items); upsert('Quotations', { id:q.id, follow_ups:(q.followUps||0)+1, last_follow_up:TODAY }); if (c && c.telegram_id){ send(c.telegram_id, `أهلاً أستاذ ${firstName(c.name)} 👋\nبنذكّر حضرتك بعرض السعر *${q.id}* (${items[0]?items[0].name:''} — ${money(q.total)}) المرسل بتاريخ ${fmtDateAr(q.date)}.\nلو في أي استفسار أو تعديل قولنا وإحنا جاهزين 🙏`); sent++; } else skipped++; }); return { reply:`تم تسجيل متابعة لـ *${targets.length}* عرض سعر عدّى عليها أكتر من ${db.settings.followUpDays} أيام بدون رد:\n${targets.map(q=>`• ${q.id} — ${q.customerId?customerName(db,q.customerId):'عميل جديد'} — ${daysBetween(q.date,NOW)} يوم`).join('\n')}\n\nاتبعت رسالة تذكير فعلاً لـ ${sent} عميل مرتبط بتليجرام${skipped?`، و${skipped} عميل غير مرتبط (في الإنتاج هتتبعت واتساب تلقائياً)`:''}.` }; };
H.SALES_REPORT = (a,e) => { const period = e.period==='month'?30:7; const from = fmtDate(addDays(NOW,-period)); const q = db.quotations.filter(x=>x.date>=from), acc = q.filter(x=>x.status==='accepted'); const leads = db.leads.filter(x=>x.date>=from), orders = db.orders.filter(x=>x.date>=from); const inv = db.invoices.filter(x=>x.date>=from), pays = db.payments.filter(x=>x.date>=from); return { reply:`📊 *تقرير المبيعات — آخر ${period} يوم*\n\nفرص جديدة (Leads): ${leads.length}\nعروض أسعار: ${q.length} بقيمة ${money(sum(q,x=>x.total))}\nعروض مقبولة: ${acc.length} بقيمة ${money(sum(acc,x=>x.total))}\nنسبة القبول: ${q.length?Math.round(acc.length/q.length*100):0}%\nأوامر شغل: ${orders.length}\n\nفواتير صادرة: ${inv.length} بقيمة ${money(sum(inv,x=>x.amount))}\nتحصيلات: ${pays.length} دفعة بقيمة ${money(sum(pays,x=>x.amount))}` }; };
H.WHO_OWES = (a,e) => { const days = e.days || db.settings.overdueDays; const cut = fmtDate(addDays(NOW,-days)); const map = {}; db.invoices.forEach(i => { if (i.remaining>0 && i.dueDate<=cut){ const m = map[i.customerId] = map[i.customerId]||{amt:0,n:0,oldest:i.dueDate}; m.amt+=i.remaining; m.n++; if (i.dueDate<m.oldest) m.oldest=i.dueDate; } }); const rws = Object.entries(map).map(([cid,v])=>({cid,...v})).sort((x,y)=>y.amt-x.amt); if (!rws.length) return { reply:`مفيش عملاء متأخرين أكتر من ${days} يوم 🎉` }; return { reply:`العملاء المتأخرين أكتر من *${days} يوم* (${rws.length} عميل):\n${rws.slice(0,10).map((r,i)=>`${i+1}. ${customerName(db,r.cid)} — *${money(r.amt)}* — ${r.n} فاتورة — أقدم استحقاق ${fmtDateAr(r.oldest)}`).join('\n')}${rws.length>10?`\n… و${rws.length-10} عميل آخر`:''}\n\n*إجمالي المتأخر: ${money(sum(rws,r=>r.amt))}*` }; };
H.CUSTOMER_SEARCH = (a,e) => { const c = e.customer_id ? byId(db.customers,e.customer_id) : null; if (!c) return (e.customer_name||e.company_text) ? { reply:`مش لاقي عميل باسم "${e.customer_name||e.company_text}". جرّب اسم الشركة بدون "شركة/مؤسسة" أو اسم المسؤول.` } : { askCustomer:true }; const b = customerBalance(db,c.id); const rep = byId(db.users,c.salesRep); let t = `👤 *${c.company}* (${c.id})\nالمسؤول: ${c.name}\nالجوال: ${c.phone}\nالمدينة: ${c.city||'—'}\nالرقم الضريبي: ${c.vat||'—'}\nحد الائتمان: ${money(c.creditLimit)}\nالحالة: ${STATUS_AR[c.status]||c.status}\nمندوب المبيعات: ${rep?rep.name:'—'}\nتليجرام: ${c.telegram_id?'مرتبط ✅':'غير مرتبط'}`; t += `\nالرصيد المستحق: ${money(b.remaining)}${a.role!=='sales'?` (${b.count} فاتورة)`:''}`; return { reply:t }; };
H.CREATE_QUOTATION = () => ({ startFlow:'CREATE_QUOTATION' }); H.RECORD_PAYMENT = () => ({ startFlow:'RECORD_PAYMENT' }); H.CREATE_INVOICE = () => ({ startFlow:'CREATE_INVOICE' }); H.CREATE_CUSTOMER = () => ({ startFlow:'CREATE_CUSTOMER' }); H.CREATE_LEAD = () => ({ startFlow:'CREATE_LEAD' });
H.LIST_APPROVALS = (a) => { const list = db.approvals.filter(x=>x.status==='pending' && (a.role==='admin' || x.approverRole===a.role)); if (!list.length) return { reply:'مفيش طلبات معلقة تخصك دلوقتي ✅' }; const T = { CREATE_INVOICE:'إصدار فاتورة', RECORD_PAYMENT:'ترحيل دفعة', CREATE_CUSTOMER:'إضافة عميل', SEND_QUOTATION:'عرض سعر' }; return { reply:`الطلبات المعلقة (${list.length}):\n${list.map(x=>`• *${x.id}* — ${T[x.type]||x.type} — ${x.payload.customer||x.payload.company||''} — ${x.payload.amount?money(x.payload.amount):x.payload.total?money(x.payload.total):''} — من ${x.requestedBy}`).join('\n')}\n\nللاعتماد: اعتمد AP-رقم — للرفض: ارفض AP-رقم السبب` }; };
H.APPROVE = (a,e) => decideCmd(a,e,true); H.REJECT = (a,e) => decideCmd(a,e,false);
function decideCmd(a,e,approve){ const id = e.ref_id; const ap = id ? db.approvals.find(x=>x.id===id) : null; if (!ap) return { reply:`مش لاقي طلب برقم ${id||'؟'}. اكتب "الطلبات المعلقة" تشوف الأرقام.` }; if (ap.status!=='pending') return { reply:`الطلب ${ap.id} اتقفل قبل كده (${STATUS_AR[ap.status]||ap.status} بواسطة ${ap.decidedBy}).` }; if (!(a.role==='admin' || ap.approverRole===a.role)) return { reply:`الطلب ${ap.id} يعتمده ${ROLE_AR[ap.approverRole]} مش ${ROLE_AR[a.role]} 🔒`, denied:true }; const note = S_(e._raw).replace(/^\s*(اعتمد|اعتماد|وافق|ارفض|رفض|approve|reject)\s*/i,'').replace(/\s*(ap|AP)[-\s]?\d+\s*/,'').trim(); const result = decideApproval(ap, approve, a.name, approve?'':note); return { reply: approve ? `✅ تم اعتماد ${ap.id}${result?' — '+result:''}. اتبعت إشعار لصاحب الطلب.` : `❌ تم رفض ${ap.id}${note?' — '+note:''}.` }; }
H.HUMAN_REPLY = (a,e) => { const h = e.ref_id ? db.handoffs.find(x=>x.id===e.ref_id) : null; if (!h) return { reply:`مش لاقي تحويل برقم ${e.ref_id||'؟'}.` }; const text = S_(e._raw).replace(/^\s*(رد|reply)\s*/i,'').replace(/\s*(ho|HO)[-\s]?\d+\s*/,'').trim(); if (!text) return { reply:'اكتب الرد بعد الرقم: رد HO-1 نص الرد' }; send(h.chatId, `👤 رد من ${a.name}:\n${text}`); upsert('Handoffs', { id:h.id, status:'resolved', reply:text }); return { reply:`اتبعت الرد لصاحب ${h.id} ✅` }; };
H.UNKNOWN = (a) => ({ handoff:'intent غير مفهوم', reply:'مش متأكد إني فهمت طلبك بالظبط 🙏\nحوّلت رسالتك لزميلنا وهيرد عليك في أقرب وقت.\n\nأو اكتب "مساعدة" عشان تشوف اللي أقدر أعمله.' });

function runIntent(it, a, ents){
  const allowed = (PERMS[a.role]||[]).includes(it);
  if (!allowed){ denied = true; if (a.role==='unknown') return { reply:`حسابك مش مرتبط بعميل مسجل، فمش هقدر أعرض بيانات حسابات 🔒\n\n• لو أنت عميل حالي: ابعت رقم جوالك المسجل (مثال: +966501234567).\n• لو محتاج خدمة: اكتب "عايز عرض سعر" وأنا هساعدك.`, denied:true }; return { reply:`الطلب ده (${INTENT_AR[it]||it}) خارج صلاحيات ${ROLE_AR[a.role]} 🔒\nلو محتاجه اتواصل مع ${/INVOICE|PAYMENT|STATEMENT|WHO_OWES/.test(it)?'المحاسب':'المدير'}.`, denied:true }; }
  const h = H[it] || H.UNKNOWN; let res = h(a, ents);
  if (res.askCustomer){ ctx = startFlow('NEED_CUSTOMER', a); ctx.intent = it; ctx.entities = ents; ctx.asked='customer'; return { reply: ents.customer_name ? `مش لاقي عميل باسم "${ents.customer_name}". اكتب اسم الشركة زي ما هو مسجل.` : SLOT_Q.customer }; }
  if (res.askInvoice){ ctx = startFlow('NEED_INVOICE', a); ctx.intent = it; ctx.entities = ents; ctx.asked='invoice_no'; return { reply:'رقم الفاتورة كام؟ (مثال: 1023)' }; }
  if (res.startFlow){ ctx = startFlow(res.startFlow, a, { entities:ents, flow_answer:null }, raw); if (ctx.missing.length) return { reply: nextQuestion(ctx) }; ctx.confirming = true; return { reply: confirmSummary(ctx) }; }
  return res;
}

/* =================== main pipeline =================== */
let result = null;
if (!reply && nlu){
  if (ctx && ctx.flow && (intent==='FLOW_ANSWER'||intent==='CONFIRM'||intent==='DENY'||intent==='CANCEL'||ctx.flow==='NEED_CUSTOMER'||ctx.flow==='NEED_INVOICE')){
    if (intent==='CANCEL' || (intent==='DENY' && ctx.confirming)){ result = { reply: intent==='CANCEL' ? 'تم إلغاء الطلب. لو احتجت حاجة تانية أنا موجود 🙂' : 'تمام، ألغيت الطلب. اكتب الطلب من جديد بالبيانات الصحيحة.' }; ctx = null; }
    else if (intent==='CONFIRM' && ctx.confirming){ const r = executeFlow(ctx, actor); if (r && r.reopen){ result = { reply:r.text }; } else { result = { reply:r }; ctx = null; } }
    else if (ctx.flow==='NEED_CUSTOMER' || ctx.flow==='NEED_INVOICE'){ fillSlots(ctx, raw, nlu, actor); if (ctx.missing.length) result = { reply: ctx.flow==='NEED_CUSTOMER' ? 'مش لاقي عميل بالاسم ده. اكتب اسم الشركة زي ما هو مسجل (مثال: النخيل، الأفق).' : 'محتاج رقم الفاتورة (مثال: 1023).' }; else { const orig = ctx; intent = orig.intent; const ents = Object.assign({}, nlu.entities, orig.entities||{}); if (orig.slots.customer) ents.customer_id = orig.slots.customer; if (orig.slots.invoice_no) ents.invoice_no = orig.slots.invoice_no; ctx = null; result = runIntent(intent, actor, ents); } }
    else { fillSlots(ctx, raw, nlu, actor); if (ctx.missing.length) result = { reply: nextQuestion(ctx) }; else { ctx.confirming = true; ctx.asked = null; result = { reply: confirmSummary(ctx) }; } }
    if (ctx===null || (ctx && ctx.intent)) { /* log under the flow's intent */ if (intent==='FLOW_ANSWER'||intent==='CONFIRM'||intent==='DENY'||intent==='CANCEL') intent = (result && result._it) || (conv.context && conv.context.intent) || intent; }
  } else {
    if (ctx && ctx.flow && !['GREETING','THANKS','HELP'].includes(intent)) ctx = null;
    if (intent==='CONFIRM'||intent==='DENY'||intent==='FLOW_ANSWER'){ intent='UNKNOWN'; }
    if (intent==='CANCEL') result = { reply:'مفيش طلب شغال حالياً عشان ألغيه. اكتب طلبك وأنا جاهز 🙂' };
    else result = runIntent(intent, actor, nlu.entities);
  }
  reply = result.reply; if (result.denied) denied = true;
  if (result.handoff){ const h = { id: db.nextId('HO-', db.handoffs, 1) }; db.handoffs.unshift(h); handoffMade = true; append('Handoffs', { id:h.id, ts:new Date().toISOString(), chat_id:chatId, actor:actor.name, role:actor.role, message:raw, reason:result.handoff, status:'open', reply:'' }); notifyRole('admin', `🙋 تحويل بشري *${h.id}*\nمن: ${actor.name} (${ROLE_AR[actor.role]}) — chat ${chatId}\nالرسالة: "${raw}"\nالسبب: ${result.handoff}\n\nللرد اكتب: رد ${h.id} نص الرد`, h.id); }
  if (intent==='UNKNOWN') success = false;
}

/* =================== reply, state, log =================== */
if (reply) send(chatId, reply);
if (NOTES.length && STAFF(actor.role)) send(chatId, 'ℹ️ ' + NOTES.join('\nℹ️ '));
const hist = history.concat([{ dir:'out', text:raw.slice(0,300), ts:new Date().toISOString() }, { dir:'in', text:S_(reply).slice(0,300), ts:new Date().toISOString() }]).slice(-8);
upsert('Conversations', { id:chatId, phone:linkedPhone, role:actor.role, name:actor.name, context: ctx ? JSON.stringify(ctx) : '', history: JSON.stringify(hist), last_message: raw.slice(0,200), updated_at: new Date().toISOString() });
append('RequestLog', { id:'RQ-'+Date.now(), ts:new Date().toISOString(), chat_id:chatId, role:actor.role, actor:actor.name, text:raw.slice(0,200), intent, engine, confidence, success: success && !denied ? 'TRUE':'FALSE', denied: denied?'TRUE':'FALSE', handoff: handoffMade?'TRUE':'FALSE', latency_ms: Date.now()-T0 });
return OUT.map(j => ({ json: j }));
