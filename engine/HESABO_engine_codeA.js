/* ===================================================================
   HESABO — Code node A: "Build AI Prompt"
   Reads the Telegram update + the sheets, identifies the sender and
   builds the Gemini request body. Nothing is written here.
   =================================================================== */
const rows = makeRowsReader($);
const upd = $('Telegram Trigger').first().json;
const msg = upd.message || upd.edited_message || {};
const text = S_(msg.text || msg.caption || '');
const chatId = S_(msg.chat && msg.chat.id);
const cfg = $('Config').first().json;
const db = loadDB({ Settings: rows('Read Settings'), Users: rows('Read Users'), Customers: rows('Read Customers'), Products: rows('Read Products'), Conversations: rows('Read Conversations') });
const actor = resolveActor(db, chatId, msg.from);
const conv = actor.conv; const ctx = conv ? conv.context : null; const history = conv ? conv.history : [];
const isCommand = /^\//.test(text) || !!msg.contact || !text.trim() || looksLikePhone(text);
const mode = S_(cfg.aiMode || 'auto').toLowerCase();
// deterministic commands (approve/reject/reply/pending list/yes/no/cancel) never need the AI
let sure = false;
try { const r = ruleNLU(db, text, ctx); sure = r && r.confidence >= 0.9 && ['APPROVE','REJECT','HUMAN_REPLY','LIST_APPROVALS','CONFIRM','DENY','CANCEL'].includes(r.intent); } catch(e){}
const useAI = !!S_(cfg.geminiApiKey).trim() && mode !== 'rules' && !isCommand && !sure;
const prompt = buildAIPrompt(db, text, actor, ctx, history);
return [{ json: { useAI, chatId, text, role: actor.role, geminiBody: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 600 } } } }];
