# التصور الإنتاجي لبوابة Perfect Scan

## المستخدمون والصلاحيات

### Patient

- حجز فحص في أحد فرعي Perfect Scan.
- مشاهدة تعليمات التحضير، الموعد، وحالة الحجز.
- مشاهدة التقرير والصور بعد اعتماد طبيب الأشعة.
- لا يمكنه الوصول إلا إلى ملفه أو الملفات التابعة له بتفويض موثق.

### Admin / Reception

- إدارة مواعيد الفرعين وتسجيل وصول المرضى.
- إدارة أنواع الفحوصات ومددها وأسعارها وتحضيراتها.
- ربط الفحص بطلب الطبيب والملفات المستلمة.
- متابعة حالة الأجهزة والطاقة الاستيعابية.

### Radiologist

- فتح قائمة الفحوصات المسندة إليه.
- كتابة التقرير ومراجعته واعتماده بتوقيع رقمي.
- لا يظهر التقرير للمريض قبل الاعتماد النهائي.

## نموذج البيانات

```text
users
  id, role, full_name, phone, email, password_hash, status

patients
  id, user_id, national_id_encrypted, birth_date, gender, medical_notes

branches
  id, name, address, phone, landline, opening_hours, status

imaging_services
  id, code, name, duration_minutes, preparation, price, status

devices
  id, branch_id, modality, name, status, maintenance_at

appointments
  id, patient_id, branch_id, service_id, device_id,
  starts_at, ends_at, status, referral_file_id, created_by

imaging_studies
  id, appointment_id, accession_number, modality, performed_at,
  dicom_study_uid, radiologist_id, status

radiology_reports
  id, study_id, findings, impression, status,
  authored_by, approved_by, approved_at, version

medical_files
  id, patient_id, study_id, type, storage_key,
  mime_type, size, checksum, created_at

notifications
  id, user_id, channel, template, payload, sent_at, read_at

audit_logs
  id, actor_user_id, action, resource_type, resource_id, metadata, created_at
```

## قواعد التشغيل الأساسية

1. التوافر يُحسب حسب الفرع ونوع الفحص والجهاز ومدة الفحص.
2. تأكيد الموعد يتم داخل database transaction مع قيد يمنع حجز الجهاز مرتين في نفس الوقت.
3. حالات الفحص: `booked`, `checked_in`, `in_progress`, `performed`, `reported`, `approved`, `delivered`, `cancelled`, `no_show`.
4. التقرير لا يظهر للمريض إلا بعد `approved`، وأي تعديل لاحق ينشئ version جديدًا.
5. صور DICOM تحفظ في PACS أو تخزين طبي مخصص، وليس كرابط عام.
6. كل عرض أو تحميل لتقرير أو صورة يسجل في `audit_logs`.

## واجهات API المقترحة

```text
POST   /api/auth/login
GET    /api/services
GET    /api/branches
GET    /api/availability?branchId=&serviceId=&from=&to=
POST   /api/appointments
GET    /api/me/appointments
PATCH  /api/appointments/:id/cancel
GET    /api/me/studies
GET    /api/me/studies/:id/report
GET    /api/me/studies/:id/images

GET    /api/admin/dashboard
GET    /api/admin/appointments
PATCH  /api/admin/appointments/:id/status
GET    /api/admin/reports/pending
POST   /api/radiologist/studies/:id/report
POST   /api/radiologist/reports/:id/approve
CRUD   /api/admin/services
CRUD   /api/admin/devices
```

## الحماية المطلوبة

- PostgreSQL للبيانات التشغيلية، وprivate object storage أو PACS للصور الطبية.
- صلاحيات على السيرفر لـ `patient`, `reception`, `admin`, `radiologist`.
- تشفير الرقم القومي والبيانات الطبية والملفات أثناء النقل والتخزين.
- روابط قصيرة العمر للتقارير والصور، مع منع التخزين العام.
- Audit log غير قابل للتعديل، نسخ احتياطية مشفرة، واختبارات استعادة دورية.
- تطبيق متطلبات حماية البيانات والقوانين الطبية المحلية قبل التشغيل الحقيقي.
