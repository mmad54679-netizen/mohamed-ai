// حلقة الوكيل: يرسل المحادثة والأدوات للنموذج، ينفّذ استدعاءات الأدوات، ويكرر حتى تأتي إجابة نهائية.
function trimHistory(messages, maxChars = 90000) {
  let total = messages.reduce((n, m) => n + String(m.content || '').length, 0);
  for (let i = 1; i < messages.length - 6 && total > maxChars; i++) {
    const m = messages[i];
    if (m.role === 'tool' && m.content.length > 400) {
      total -= m.content.length - 400;
      m.content = `${m.content.slice(0, 400)}\n... [اختُصر لتوفير السياق]`;
    }
  }
}

async function runAgent({ providers, messages, toolDefs, execute, maxSteps = 25, onText = () => {}, onTool = () => {} }) {
  let order = [...providers];
  for (let step = 1; step <= maxSteps; step++) {
    trimHistory(messages);
    let message = null;
    const errors = [];
    for (const provider of order) {
      try { message = await provider.chat({ messages, tools: toolDefs }); order = [provider, ...order.filter(p => p !== provider)]; break; }
      catch (error) { errors.push(`${provider.name}: ${error.message}`); }
    }
    if (!message) throw new Error(`فشل كل المزوّدين:\n${errors.join('\n')}`);

    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    messages.push({ role: 'assistant', content: message.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
    if (message.content) onText(message.content);
    if (!calls.length) return { text: message.content || '', steps: step };

    for (const call of calls) {
      let args = {};
      let result;
      try { args = JSON.parse(call.function?.arguments || '{}'); }
      catch { result = 'خطأ: معاملات الأداة ليست JSON صالحًا؛ أعد المحاولة.'; }
      onTool(call.function?.name, args);
      if (result === undefined) result = await execute(call.function?.name, args);
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
  return { text: 'توقفت لأني وصلت للحد الأقصى من الخطوات؛ اطلب مني المتابعة.', steps: maxSteps };
}

module.exports = { runAgent, trimHistory };
