const SKILL_DEFINITIONS = [
  { id: 'conversation', name: 'المحادثة العامة', category: 'أساسي', description: 'أسئلة وأجوبة عربية مع سياسة عدم اختلاق المعلومات.', kind: 'built_in', enabled: true, readOnly: true },
  { id: 'writing', name: 'الكتابة والتحرير', category: 'محتوى', description: 'صياغة الرسائل والمقالات والملخصات وإعادة الكتابة.', kind: 'built_in', enabled: true, readOnly: true },
  { id: 'translation', name: 'الترجمة', category: 'لغة', description: 'ترجمة النصوص مع الحفاظ على المعنى والنبرة.', kind: 'built_in', enabled: true, readOnly: true },
  { id: 'summarization', name: 'التلخيص والاستخراج', category: 'محتوى', description: 'تلخيص المحادثات والوثائق واستخراج النقاط المهمة.', kind: 'built_in', enabled: true, readOnly: true },
  { id: 'tutoring', name: 'التعليم والشرح', category: 'تعليم', description: 'شرح المفاهيم خطوة بخطوة وطرح أسئلة للمراجعة.', kind: 'built_in', enabled: true, readOnly: true },
  { id: 'coding', name: 'البرمجة ومراجعة الكود', category: 'برمجة', description: 'شرح وكتابة ومراجعة وتصحيح أمثلة برمجية.', kind: 'built_in', enabled: true, readOnly: true },
  { id: 'safe_calculator', name: 'الحساب الآمن', category: 'أدوات محلية', description: 'حساب العمليات الرياضية المسموحة دون تنفيذ كود عشوائي.', kind: 'local_tool', permission: 'calculator', enabled: true, readOnly: true },
  { id: 'date_time', name: 'الوقت والتاريخ', category: 'أدوات محلية', description: 'قراءة الوقت والتاريخ بصيغة UTC من الجهاز/الخادم.', kind: 'local_tool', permission: 'date_time', enabled: true, readOnly: true },
  { id: 'planning', name: 'التخطيط والمهام', category: 'وكيل', description: 'تحويل الهدف إلى خطوات قصيرة وتحديد ما يحتاج موافقة.', kind: 'agent', permission: 'planning', enabled: true, readOnly: true },
  { id: 'image_analysis', name: 'تحليل الصور', category: 'وسائط', description: 'تحليل صورة مرفقة عندما يدعم مزود النموذج ذلك.', kind: 'model_dependent', permission: 'image_analysis', enabled: true, readOnly: true },
  { id: 'voice_input', name: 'الإدخال الصوتي العربي', category: 'جهاز', description: 'تحويل الكلام العربي إلى نص محليًا بعد إذن الميكروفون.', kind: 'device', enabled: true, readOnly: true },
  { id: 'speech_output', name: 'قراءة الرد بصوت عربي', category: 'جهاز', description: 'قراءة آخر إجابة عبر محرك النطق المحلي.', kind: 'device', enabled: true, readOnly: true },
  { id: 'local_inference', name: 'المعالجة المحلية', category: 'خصوصية', description: 'محاولة الإجابة نصيًا دون إرسال السؤال للسحابة بعد تنزيل النموذج.', kind: 'optional_local', enabled: true, readOnly: true },
  { id: 'github_read', name: 'قراءة GitHub', category: 'تكاملات', description: 'قراءة المستودعات والملفات دون كتابة أو حذف أو نشر.', kind: 'connector', connector: 'github', enabled: true, readOnly: true },
  { id: 'drive_read', name: 'قراءة Google Drive', category: 'تكاملات', description: 'قراءة PDF وWord وGoogle Docs ضمن حدود الحجم والنوع.', kind: 'connector', connector: 'google_drive', enabled: true, readOnly: true },
  { id: 'gmail_read', name: 'قراءة Gmail', category: 'تكاملات', description: 'البحث وقراءة بيانات وصفية للرسائل فقط؛ لا إرسال تلقائي.', kind: 'connector', connector: 'gmail', enabled: true, readOnly: true },
  { id: 'calendar_read', name: 'قراءة Google Calendar', category: 'تكاملات', description: 'عرض الأحداث فقط؛ لا إنشاء أو تعديل أو حذف تلقائي.', kind: 'connector', connector: 'calendar', enabled: true, readOnly: true },
  { id: 'web_search', name: 'البحث في الويب', category: 'بحث', description: 'بحث قراءة فقط يعيد الرابط والمصدر والمقتطف.', kind: 'connector', connector: 'web_search', enabled: true, readOnly: true },
  { id: 'qureo_safe', name: 'مساعد QUREO الآمن', category: 'تعليم', description: 'شرح أسئلة QUREO وتشغيل محدود بعد تحقق محلي وموافقة المستخدم.', kind: 'specialized', enabled: true, readOnly: false },
  { id: 'export_share', name: 'التصدير والمشاركة', category: 'إنتاجية', description: 'تصدير المحادثة أو مشاركة الإجابة من الجهاز بعد طلب المستخدم.', kind: 'device', enabled: true, readOnly: false },
];

function skillStatus(env = process.env, connectors = []) {
  const connectorMap = new Map(connectors.map(item => [item.id, item]));
  return SKILL_DEFINITIONS.map(skill => {
    const connector = skill.connector ? connectorMap.get(skill.connector) : null;
    let state = skill.enabled ? 'available' : 'disabled';
    let reason = '';
    if (skill.kind === 'connector') {
      state = connector?.available ? 'configured' : 'needs_setup';
      reason = connector?.available ? 'مهيأ على الخادم' : 'يحتاج توكن/مفتاحًا على الخادم';
    } else if (skill.kind === 'model_dependent') {
      state = env.GEMINI_API_KEY || env.GROQ_API_KEY ? 'available' : 'needs_setup';
      reason = state === 'available' ? 'يعتمد على مزود النموذج' : 'يحتاج مزود نموذج مضبوطًا';
    } else if (skill.kind === 'optional_local') {
      state = 'optional';
      reason = 'يتطلب تنزيل النموذج من داخل التطبيق';
    } else if (skill.kind === 'device') {
      reason = 'يعمل بعد إذن الجهاز عند الحاجة';
    }
    return { ...skill, state, reason };
  });
}

module.exports = { SKILL_DEFINITIONS, skillStatus };
