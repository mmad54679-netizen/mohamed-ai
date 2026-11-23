# خدمة OpenManus الاختيارية

هذه الخدمة إضافة مستقلة لمشروع Mohamed AI. ثبّت المستودع الرسمي من [FoundationAgents/OpenManus](https://github.com/FoundationAgents/OpenManus) داخل حاوية أو VM منفصلة، ثم انسخ `server.py` إلى جذر المستودع وشغّله من بيئته الافتراضية. اتبع README الرسمي لتثبيت Python 3.12 والاعتماديات وتهيئة `config/config.toml` بمزوّد النموذج.

## تشغيل تجريبي محلي

```sh
export OPENMANUS_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
export OPENMANUS_HOST=127.0.0.1
export OPENMANUS_PORT=8091
export OPENMANUS_DISABLE_BROWSER_USE=1
python server.py
```

في خادم Node.js اضبط **القيمة نفسها** لـ`OPENMANUS_TOKEN`، ثم `OPENMANUS_URL=http://127.0.0.1:8091` و`APP_PASSWORD`. إذا كان Node وOpenManus على جهازين مختلفين استخدم عنوان HTTPS خاصًا بدل HTTP. لا تجعل منفذ الجسر عامًا.

## الوضع الآمن

الجسر يقيّد الطلب إلى 8 خطوات و12,000 حرف. افتراضيًا لا يهيئ خوادم MCP ويزيل أدوات تنفيذ Python وتحرير الملفات من قائمة الأدوات. هذا يقلّل المخاطر لكنه يحدّ قدرات التنفيذ؛ لا توسّع قائمة الأدوات إلا داخل حاوية معزولة بصلاحيات وملفات محدودة، وبعد اختبارها. لا تضع أسرارًا في رسائل المستخدم. نموذج OpenManus وأدواته قد يستهلكان موارد أو خدمات مدفوعة حسب إعدادك.

تطبيق Android يتصل بخادم Node.js فقط؛ لا تضع `OPENMANUS_TOKEN` ولا مفاتيح النماذج داخل APK. اختيار OpenManus في الواجهة يعمل فقط مع خادم Node.js الذي يوفّر `/api/openmanus`؛ لا يعمل تلقائيًا مع Worker قديم.
