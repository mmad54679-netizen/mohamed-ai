# فريق التطبيقات الافتراضي

أُضيف وضع اختياري اسمه «فريق صناعة التطبيقات». يحتفظ التطبيق بمسار المحادثة العام وQUREO كما هما. ينسق CrewAI الخطة: يختار محدد أدوار ثنائي اللغة حتى خمسة مختصين، ويجمع القائد مساهماتهم. يغطي الفريق المنتج، المعمارية، UX/UI، الواجهة الأمامية والخلفية، تطبيقات الهاتف، قواعد البيانات والبيانات، الذكاء الاصطناعي والتعلم الآلي، الاختبار، الأمن والخصوصية، السحابة وDevOps، والتوثيق الفني. الاختيار الحالي يعتمد مطابقة كلمات؛ ليس تصنيفًا مضمونًا لكل صياغة.

يظل CrewAI للتخطيط فقط: لا يملك أدوات كتابة ملفات أو تنفيذ أوامر. إذا فعّل المستخدم خيار إنشاء الملفات، يرسل خادم Node.js الفكرة وخلاصة خطة CrewAI إلى خدمة MetaGPT مستقلة. تعمل MetaGPT داخل حاوية وبيئة ملفات منفصلتين، ثم يمكن تنزيل ZIP لمراجعته. لا يوجد دمج إلى المستودع ولا commit ولا نشر تلقائي.

الأسماء الحالية شخصيات ذكاء اصطناعي افتراضية وليست أشخاصًا حقيقيين، ويمكن تغييرها بتعديل `crewai-service/roster.example.json` وتهيئة `ROSTER_FILE`، أو باستخدام متغيرات `NAME_LEADER`, `NAME_PRODUCT`, `NAME_ARCHITECTURE`, `NAME_DESIGN`, `NAME_FRONTEND`, `NAME_BACKEND`, `NAME_MOBILE`, `NAME_DATA`, `NAME_AI_ML`, `NAME_QA`, `NAME_SECURITY`, `NAME_DEVOPS`, `NAME_DOCS`. لا يعرض التطبيق هوية مزوّد النموذج للمستخدم.

## ربط الخدمات بخادم Node.js

شغّل خدمة CrewAI على Python 3.12 أو أحدث. تتطلب `SERVICE_TOKEN` طويلًا عشوائيًا، وإعداد مفتاح مزوّد نموذج لطلبات الإنتاج. شغّل خدمة MetaGPT داخل Docker باستخدام Python 3.11؛ يجب تعيين `SERVICE_BEARER_TOKEN` وإعداد بيانات مزوّد النموذج داخل الحاوية بطريقة آمنة. تفاصيل المتطلبات والقيود موضحة في ملف README الخاص بكل خدمة.

أضف إلى بيئة تشغيل خادم Mohamed AI المتغيرات التالية عبر مدير الأسرار، لا تكتب أسرارًا في الواجهة أو المستودع:

```text
TEAM_SERVICE_URL=http://127.0.0.1:8081
TEAM_SERVICE_TOKEN=<same secret as CrewAI SERVICE_TOKEN>
TEAM_SERVICE_ALLOW_HTTP=1
METAGPT_SERVICE_URL=http://127.0.0.1:8082
METAGPT_SERVICE_TOKEN=<same secret as MetaGPT SERVICE_BEARER_TOKEN>
METAGPT_SERVICE_ALLOW_HTTP=1
```

هذه العناوين مناسبة فقط عندما تكون الخدمات على الجهاز نفسه ومربوطة بـlocalhost. عند استخدام شبكات حاويات خاصة، استخدم أسماء الخدمات الداخلية على الشبكة نفسها واسمح بـHTTP فقط إذا كان المرور محصورًا فعلًا داخل شبكة موثوقة؛ غير ذلك استخدم HTTPS. لا تفتح منافذ الخدمات للعامة. احتفظ بخدمة MetaGPT خلف جدار ناري أو proxy موثوق، وخصص لها CPU/ذاكرة وعدد عمليات، ولا تركّب مستودع المستخدم أو Docker socket أو أسرار المضيف داخل حاويتها. المثال أدناه يحدد بعض حدود الموارد لكنه لا يقيّد حركة الشبكة الصادرة تلقائيًا؛ أضف قواعد شبكة/جدار ناري مناسبة للبيئة، خصوصًا أن العامل ينفذ عمليات بناء واختبار.

في Android، يجب أن يشير «عنوان خادم المساعد الخاص» إلى خادم Node.js الذي يعمل كوكيل للخدمتين؛ لا تضع عناوين CrewAI أو MetaGPT أو مفاتيحها في التطبيق. يلزم HTTPS عام للخادم عند الاتصال من الهاتف. بعد إعداد الخدمات، اختر «فريق صناعة التطبيقات» لإنتاج الخطة. أنشئ الملفات فقط بتفعيل مربع MetaGPT الاختياري. التنزيل محمي بكلمة مرور خادم المساعد.

## حدود النسخة الحالية

اختيار المختصين مبني على كلمات ثابتة، وقد يحتاج تحسينًا باستخدام مصنّف يقوده نموذج. توليد MetaGPT متزامن وقد يستغرق وقتًا طويلًا، لذلك توجد مهلة محدودة من خادم التطبيق. إنشاء المشاريع لم يُختبر فعليًا مع مفتاح مزوّد أو Docker في بيئة التطوير الحالية. لا تُسجّل أسرار مزود النموذج في سجلات الخدمة، وراجع أي ملفات مولدة قبل تشغيلها أو إضافتها إلى مشروعك.

## الخدمات والمصادر الرسمية

- CrewAI: [التوثيق الرسمي](https://docs.crewai.com/en/quickstart) و[إنشاء الأدوات المخصصة](https://docs.crewai.com/v1.15.42/en/learn/create-custom-tools). خدمة Mohamed AI لا تستخدم أدوات مخصصة ضمن التخطيط الحالي.
- MetaGPT: [المستودع الرسمي](https://github.com/FoundationAgents/MetaGPT) و[دليل المقدمة](https://docs.deepwisdom.ai/main/en/guide/get_started/introduction.html). متطلبات Python ومصدر واجهة `generate_repo` موضحان في `metagpt-service/README.md`.

## مثال تشغيل محلي

من مجلد المشروع، أنشئ رمزين مختلفين ولا تحفظهما في Git. ابنِ الحاويتين ثم اربط المنافذ بـlocalhost فقط:

```sh
export TEAM_SERVICE_TOKEN="$(openssl rand -hex 32)"
export METAGPT_SERVICE_TOKEN="$(openssl rand -hex 32)"
docker build -t mohamed-crewai team-runtime/crewai-service
docker build -t mohamed-metagpt team-runtime/metagpt-service
docker run -d --name mohamed-crewai -p 127.0.0.1:8081:8080 \
  -e SERVICE_TOKEN="$TEAM_SERVICE_TOKEN" -e OPENAI_API_KEY="$OPENAI_API_KEY" mohamed-crewai
docker run -d --name mohamed-metagpt -p 127.0.0.1:8082:8000 \
  -e SERVICE_BEARER_TOKEN="$METAGPT_SERVICE_TOKEN" -e METAGPT_MOCK=1 \
  -v mohamed-metagpt-artifacts:/var/lib/metagpt/artifacts \
  --memory=4g --cpus=2 --pids-limit=128 mohamed-metagpt
export TEAM_SERVICE_URL=http://127.0.0.1:8081 TEAM_SERVICE_ALLOW_HTTP=1
export METAGPT_SERVICE_URL=http://127.0.0.1:8082 METAGPT_SERVICE_ALLOW_HTTP=1
```

في هذا المثال MetaGPT يعمل عمدًا بوضع المحاكاة؛ بدّله إلى إعداد إنتاجي فقط بعد تثبيت ملف إعداد المزوّد السري داخل الحاوية. شغّل خادم Node.js في البيئة نفسها ومعه `APP_PASSWORD`، ورموز الخدمات أعلاه كمتغيرات بيئة. عند وضع الخدمات على جهاز آخر، لا تنسخ هذا الإعداد ذي HTTP؛ استخدم HTTPS خاصًا. راقب سجلات الحاويتين، واحذفهما بعد الاختبار باستخدام `docker rm -f mohamed-crewai mohamed-metagpt`.

لا تتضمن هذه الخطوات بناء APK أو رفعًا إلى GitHub. لم يُنشأ أو يُدمج أي مشروع ناتج في مستودع المستخدم.
