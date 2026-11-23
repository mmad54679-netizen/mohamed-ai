(() => {
const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';
const ANDROID_NATIVE = /(?:^|[?&])native=1(?:&|$)/.test(window.location?.search || '');
const TRANSFORMERS_URL = ANDROID_NATIVE
  ? './transformers/transformers.web.min.js'
  : 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2';
  let pipelinePromise = null;
  let pipelineInstance = null;

  function lowMemory() {
    return Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory < 4;
  }

  async function loadPipeline(onProgress = () => {}) {
    if (pipelineInstance) return pipelineInstance;
    if (lowMemory()) {
      throw new Error('ذاكرة الهاتف المعلنة أقل من 4 GB؛ أوقفت تحميل النموذج لتجنّب تعليق المتصفح. ستظل المهمة محفوظة للاستئناف لاحقًا.');
    }
    if (!pipelinePromise) {
      pipelinePromise = (async () => {
        onProgress('تحميل محرك المعالجة المحلي…');
        const transformers = await import(TRANSFORMERS_URL);
        const { env, pipeline } = transformers;
        env.useBrowserCache = true;
        env.useWasmCache = true;
        if (ANDROID_NATIVE) env.backends.onnx.wasm.wasmPaths = new URL('./transformers/', window.location.href).href;
        try { env.backends.onnx.wasm.numThreads = 1; } catch {}
        const instance = await pipeline('text-generation', MODEL_ID, {
          dtype: 'q4',
          progress_callback: info => {
            if (info?.status === 'progress' && Number.isFinite(info.progress)) {
              onProgress(`تنزيل النموذج المحلي: ${Math.round(info.progress)}%`);
            } else if (info?.status === 'ready') {
              onProgress('اكتمل تجهيز النموذج المحلي.');
            }
          },
        });
        pipelineInstance = instance;
        return instance;
      })().catch(error => {
        pipelinePromise = null;
        throw error;
      });
    }
    return pipelinePromise;
  }

  async function prepare(onProgress) {
    await loadPipeline(onProgress);
    return { ready: true, model: MODEL_ID };
  }

  async function generate(text, onProgress) {
    if (!String(text || '').trim()) throw new Error('المعالجة المحلية تحتاج نص السؤال؛ لا تستطيع قراءة الصور في هذه النسخة.');
    const pipe = await loadPipeline(onProgress);
    onProgress?.('يعالج الهاتف السؤال محليًا… قد يستغرق ذلك وقتًا.');
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: `أنت مساعد عربي لحل وشرح أسئلة البرمجة في QUREO فقط لمساري JavaScript وPython. إذا كان السؤال خارج QUREO أو البرمجة، وضّح أن المساعدة هنا مخصصة لأسئلة QUREO. أجب بالعربية دائمًا، مع إبقاء الكلمات المحجوزة وأسماء الرموز بلغتها الأصلية عند الحاجة. لا تخترع معلومات أو خيارات أو شيفرات غير ظاهرة. تتبّع الكود خطوة بخطوة، وميّز الاستنتاج عن المعلومة الظاهرة. إذا كانت الصورة أو البيانات ناقصة أو ملتبسة أو لا تعرف الإجابة، صرّح بذلك واطلب توضيحًا بدل التخمين. أوقف الإجابة عند الشك. أعطِ الإجابة المقترحة ثم خطوات الفهم. هذه نسخة محلية صغيرة وقد تكون أقل دقة من الخدمات السحابية.\n\nالسؤال:\n${text}` },
      ],
    }];
    const result = await pipe(messages, {
      max_new_tokens: 320,
      do_sample: false,
      temperature: 0.2,
    });
    const generated = result?.[0]?.generated_text;
    let answer = '';
    if (Array.isArray(generated)) {
      const last = generated[generated.length - 1];
      answer = typeof last === 'string' ? last : String(last?.content || '');
    } else if (typeof generated === 'string') {
      answer = generated;
    }
    answer = answer.trim();
    if (!answer) throw new Error('لم يُنتج النموذج المحلي شرحًا واضحًا؛ بقيت المهمة محفوظة للاستئناف.');
    return answer;
  }

  window.QureoLocal = {
    modelId: MODEL_ID,
    isReady: () => Boolean(pipelineInstance),
    isLowMemory: lowMemory,
    prepare,
    generate,
  };
})();
