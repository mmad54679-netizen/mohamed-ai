(function (root) {
  async function checkAssistantServer({ baseUrl, appPassword, fetchImpl, timeoutMs = 12000 } = {}) {
    let base;
    try { base = new URL(String(baseUrl || '').trim()); }
    catch { throw new Error('أدخل عنوان خادم HTTPS صحيحًا قبل فتح QUREO.'); }
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
      throw new Error('استخدم عنوان خادم HTTPS فقط، من دون مسار أو بيانات دخول داخل الرابط.');
    }
    const password = String(appPassword || '');
    if (!password.trim()) throw new Error('أدخل كلمة مرور المساعد، لا كلمة مرور QUREO، قبل فتح QUREO.');

    const requestFetch = fetchImpl || root.fetch;
    if (typeof requestFetch !== 'function') throw new Error('الفحص المسبق غير متاح في هذا الإصدار؛ لم أفتح QUREO.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await requestFetch(new URL('/api/health', base).toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${password}`, Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('انتهت مهلة فحص الخادم؛ تحقّق من الاتصال ثم أعد المحاولة. لم أفتح QUREO.');
      throw new Error('تعذّر الوصول إلى خادم المساعد؛ تحقّق من العنوان والإنترنت. لم أفتح QUREO.');
    } finally {
      clearTimeout(timer);
    }

    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || body.code === 'APP_PASSWORD_REQUIRED') {
      throw new Error('كلمة مرور المساعد غير صحيحة. راجعها في حقل «كلمة مرور المساعد»؛ لم أفتح QUREO.');
    }
    if (!response.ok) {
      throw new Error(body.error || `رفض الخادم فحص الاتصال (HTTP ${response.status}). لم أفتح QUREO.`);
    }
    if (body.mockMode) throw new Error('الخادم في وضع الاختبار فقط ولا يحل الدروس؛ لم أفتح QUREO.');
    if (!body.providers || body.providers.gemini !== true) {
      throw new Error('الخادم متصل لكن Gemini غير مهيّأ؛ لم أفتح QUREO. تحقّق من إعداد الخادم أو امسح عنوانه لاستخدام الحلول المحلية المطابقة فقط.');
    }
    return body;
  }

  root.CueQureoPreflight = { checkAssistantServer };
  if (typeof module !== 'undefined' && module.exports) module.exports = { checkAssistantServer };
})(globalThis);
