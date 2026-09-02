/* Real authentication and data layer for the Perfect Scan portal. */
(function () {
  "use strict";

  const config = window.PERFECT_SCAN_SUPABASE;
  const client = config && window.supabase
    ? window.supabase.createClient(config.url, config.publishableKey)
    : null;
  const portalType = document.body.dataset.portal === "admin" ? "admin" : "patient";

  Object.assign(state, {
    role: null,
    session: null,
    profile: null,
    reports: [],
    patients: [],
    appointments: [],
    loading: true,
    busy: false,
    authMessage: "",
    dataError: "",
    mustChangePassword: false
  });
  localStorage.removeItem("perfectscan-role");
  localStorage.removeItem("perfectscan-appointments");

  const statusArabic = {
    confirmed: "مؤكد",
    arrived: "وصل",
    completed: "مكتمل",
    cancelled: "ملغي"
  };

  const escapeHTML = (value = "") => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function accountName() {
    return state.profile?.full_name || state.session?.user?.email?.split("@")[0] || "مستخدم";
  }

  function patientCode(profile = state.profile) {
    return profile?.patient_no ? `PS-${String(profile.patient_no).padStart(5, "0")}` : "—";
  }

  function dateParts(dateValue) {
    const date = new Date(`${dateValue}T12:00:00`);
    return {
      day: new Intl.DateTimeFormat("ar-EG", { day: "2-digit" }).format(date),
      month: new Intl.DateTimeFormat("ar-EG", { month: "long" }).format(date),
      label: new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date)
    };
  }

  function mapAppointment(row) {
    const service = SERVICES.find(item => item.id === row.service_id) || SERVICES[0];
    const branch = BRANCHES.find(item => item.id === row.branch_id) || BRANCHES[0];
    const parts = dateParts(row.appointment_date);
    return {
      id: row.id,
      bookingNo: row.booking_no,
      serviceId: row.service_id,
      service: service.name,
      branchId: row.branch_id,
      branch: branch.name,
      date: row.appointment_date,
      dateLabel: parts.label,
      day: parts.day,
      month: parts.month,
      time: row.appointment_time,
      status: statusArabic[row.status] || row.status,
      rawStatus: row.status,
      patientId: row.patient_id
    };
  }

  function mapReport(row) {
    const branch = BRANCHES.find(item => item.id === row.branch_id) || BRANCHES[0];
    return {
      rowId: row.id,
      id: row.report_code,
      serviceId: row.service_id,
      title: row.title,
      branch: branch.name,
      branchId: row.branch_id,
      date: new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${row.exam_date}T12:00:00`)),
      rawDate: row.exam_date,
      status: row.status === "ready" ? "جاهز" : "قيد المراجعة",
      doctor: row.doctor_name,
      finding: row.findings || "لم يتم إدخال وصف تفصيلي.",
      impression: row.impression || "لم يتم إدخال الانطباع التشخيصي.",
      filePath: row.file_path,
      patientId: row.patient_id
    };
  }

  function loadingView() {
    return `<main class="loading-screen">${brand()}<span class="loading-ring"></span><h1>جاري تجهيز بوابة Perfect Scan</h1><p>يتم الاتصال بحسابك بشكل آمن...</p></main>`;
  }

  function passwordChangeView() {
    return `<main class="entry ps-entry"><section class="entry-brand ps-entry-brand">${brand()}<div class="entry-copy"><span class="eyebrow" style="color:#8ee7d9">حماية حساب المريض</span><h1>كلمة مرورك،<br><em>خاصة بيك وحدك.</em></h1><p>الإدارة أنشأت الحساب بكلمة مرور مؤقتة. اختاري كلمة مرور جديدة قبل فتح ملفك الطبي.</p></div><div class="entry-scan-orbit" aria-hidden="true"><span></span><i></i></div><div class="privacy-note">${ICONS.file}<span>لن يستطيع موظف المركز معرفة كلمة المرور الجديدة</span></div></section><section class="entry-panel"><div class="login-box"><span class="eyebrow">أول تسجيل دخول</span><h2>غيّري كلمة المرور المؤقتة</h2><p class="muted">استخدمي 10 أحرف على الأقل، ويفضل أرقام ورموز.</p><form class="auth-form" id="change-password-form"><div class="field"><label>كلمة المرور الجديدة</label><input name="password" type="password" minlength="10" required autocomplete="new-password"></div><div class="field"><label>تأكيد كلمة المرور</label><input name="password_confirm" type="password" minlength="10" required autocomplete="new-password"></div>${state.authMessage ? `<div class="auth-message">${escapeHTML(state.authMessage)}</div>` : ""}<button class="btn btn-primary auth-submit" ${state.busy ? "disabled" : ""}>${state.busy ? "جاري الحفظ..." : "حفظ وفتح حسابي"}</button></form></div></section></main>`;
  }

  roleEntry = function () {
    if (state.loading) return loadingView();
    const setupError = state.session && state.dataError;
    const isAdminPortal = portalType === "admin";
    const form = setupError
      ? `<div class="setup-alert"><strong>الحساب اتسجل، لكن قاعدة البيانات لسه مش متجهزة.</strong><p>${escapeHTML(state.dataError)}</p><p>شغّلي ملف <code>supabase/schema.sql</code> كاملًا من SQL Editor، وبعدها اعملي تحديث للصفحة.</p><button class="btn btn-ghost" id="logout-button">تسجيل الخروج</button></div>`
      : `<form class="auth-form" id="auth-form">
          <div class="field"><label for="email">البريد الإلكتروني</label><input id="email" name="email" required type="email" autocomplete="email" placeholder="name@example.com"></div>
          <div class="field"><label for="password">كلمة المرور</label><input id="password" name="password" required type="password" minlength="8" autocomplete="current-password" placeholder="كلمة المرور"></div>
          ${state.authMessage ? `<div class="auth-message">${escapeHTML(state.authMessage)}</div>` : ""}
          <button class="btn btn-primary auth-submit" ${state.busy ? "disabled" : ""}>${state.busy ? "جاري تسجيل الدخول..." : "دخول آمن"}</button>
        </form>
        <div class="login-hint">${isAdminPortal ? "هذه الصفحة مخصصة لإدارة المركز فقط." : "حساب المريض ينشئه المركز، ولا يمكن إنشاء حساب جديد من هذه الصفحة."}</div>`;

    return `<main class="entry ps-entry"><section class="entry-brand ps-entry-brand">${brand()}<div class="entry-copy"><span class="eyebrow" style="color:#8ee7d9">${isAdminPortal ? "نظام إدارة برفكت سكان" : "بوابة برفكت سكان الرقمية"}</span><h1>${isAdminPortal ? "إدارة المركز،<br><em>من مكان واحد.</em>" : "فحصك وتقريرك،<br><em>في رحلة واحدة.</em>"}</h1><p>${isAdminPortal ? "تابعي المرضى والحجوزات، وارفعي تقارير الأشعة بأمان لكل مريض." : "احجز فحص الأشعة في فرع الصوالحة أو عرابي، تابع موعدك، واستلم التقرير والصور من حسابك بأمان."}</p></div><div class="entry-scan-orbit" aria-hidden="true"><span></span><i></i></div><div class="privacy-note">${ICONS.file}<span>${isAdminPortal ? "الدخول متاح للحسابات الإدارية المعتمدة فقط" : "بيانات كل مريض معزولة بحسابه وصلاحياته"}</span></div></section><section class="entry-panel"><div class="login-box"><span class="eyebrow">${isAdminPortal ? "بوابة الإدارة" : "بوابة المريض"}</span><h2>${setupError ? "خطوة إعداد أخيرة" : isAdminPortal ? "دخول إدارة <span dir=\"ltr\">Perfect Scan</span>" : "أهلاً بيك في <span dir=\"ltr\">Perfect Scan</span>"}</h2><p class="muted">${setupError ? "المشروع متصل بـSupabase بنجاح." : isAdminPortal ? "ادخلي بحساب الإدارة لفتح لوحة التحكم." : "ادخل بحسابك لمتابعة الحجوزات والتقارير."}</p>${form}</div></section></main>`;
  };

  shell = function () {
    const isAdmin = state.role === "admin";
    if (isAdmin && ["home", "appointments", "reports", "profile"].includes(state.page)) state.page = "dashboard";
    if (!isAdmin && ["dashboard", "admin-appointments", "admin-reports", "patients", "branches", "settings"].includes(state.page)) state.page = "home";
    const nav = isAdmin ? adminNav : patientNav;
    const name = accountName();
    const warning = state.dataError ? `<div class="data-warning">${escapeHTML(state.dataError)}</div>` : "";
    return `<div class="shell"><aside class="sidebar" id="sidebar">${brand()}<nav><ul class="nav-list">${nav.map(([id, label, icon]) => `<li><button class="nav-button ${state.page === id ? "active" : ""}" ${id === "book" ? "data-open-booking" : `data-page="${id}"`}>${icon}<span>${label}</span></button></li>`).join("")}</ul></nav><div class="center-contact"><span>الحجز والاستعلام</span><strong class="num">${CENTER.whatsapp}</strong></div><div class="side-user"><button class="user-chip" id="logout-button"><span class="avatar">${escapeHTML(name[0] || "م")}</span><span><strong>${escapeHTML(name)}</strong><small>${isAdmin ? "إدارة المركز" : `ملف المريض ${patientCode()}`}</small></span>${ICONS.logout}</button></div></aside><main class="main"><header class="topbar"><div style="display:flex;align-items:center;gap:12px"><button class="icon-button mobile-menu" id="menu-toggle">${ICONS.menu}</button><h1>${pageTitle()}</h1></div><div class="top-actions"><button class="icon-button" aria-label="الإشعارات">${ICONS.bell}<span class="notif-dot"></span></button></div></header><div class="content">${warning}${pageContent()}</div></main></div>`;
  };

  appointmentsPage = function () {
    const upcoming = state.appointments.filter(item => item.rawStatus === "confirmed" || item.rawStatus === "arrived");
    const previous = state.appointments.filter(item => !["confirmed", "arrived"].includes(item.rawStatus));
    const renderList = items => items.length
      ? `<div class="appointment-list">${items.map(item => `<article class="card upcoming-card"><div class="appointment-date"><strong>${item.day}</strong><span>${item.month}</span></div><div class="appointment-info"><h3>${escapeHTML(item.service)}</h3><p>${escapeHTML(item.branch)} · ${escapeHTML(item.dateLabel)}</p><p>الساعة ${escapeHTML(item.time)} · رقم الحجز #${item.bookingNo}</p></div><span class="pill ${item.rawStatus === "confirmed" ? "success" : ""}">${escapeHTML(item.status)}</span>${item.rawStatus === "confirmed" ? `<button class="btn btn-danger cancel-booking" data-id="${item.id}">إلغاء الموعد</button>` : ""}</article>`).join("")}</div>`
      : `<div class="card empty-state"><div class="empty-icon">${ICONS.calendar}</div><h3>مفيش مواعيد هنا</h3><p>ابدأ بحجز فحصك الأول في Perfect Scan.</p><button class="btn btn-primary" data-open-booking>احجز فحص</button></div>`;
    return `<div class="section-head"><div><h2>مواعيدي القادمة</h2><p>كل مواعيد الفحوصات المؤكدة.</p></div><button class="btn btn-primary" data-open-booking>+ حجز فحص</button></div>${renderList(upcoming)}<div class="section-head page-gap"><div><h2>الفحوصات السابقة</h2><p>سجل زياراتك إلى Perfect Scan.</p></div></div>${renderList(previous)}`;
  };

  reportsPage = function () {
    if (!state.reports.length) return `<div class="reports-hero"><div><span class="eyebrow">ملف الأشعة الرقمي</span><h2>تقاريرك وصورك محفوظة في مكان واحد</h2><p>لسه مفيش تقارير معتمدة مرتبطة بحسابك.</p></div><div class="report-count"><strong>0</strong><span>تقارير جاهزة</span></div></div><div class="card empty-state"><div class="empty-icon">${ICONS.file}</div><h3>لا توجد تقارير حاليًا</h3><p>عند اعتماد نتيجة الفحص هتظهر هنا تلقائيًا.</p></div>`;
    return `<div class="reports-hero"><div><span class="eyebrow">ملف الأشعة الرقمي</span><h2>تقاريرك وصورك محفوظة في مكان واحد</h2><p>كل نتيجة مرتبطة برقم الفحص، الفرع، وتاريخ الزيارة.</p></div><div class="report-count"><strong>${state.reports.filter(r => r.status === "جاهز").length}</strong><span>تقارير جاهزة</span></div></div><div class="report-grid">${state.reports.map(report => { const service = SERVICES.find(s => s.id === report.serviceId) || SERVICES[0]; return `<article class="card report-card ${report.status !== "جاهز" ? "pending" : ""}"><div class="report-preview"><span>${service.code}</span><div class="image-lines"><i></i><i></i><i></i></div></div><div class="report-body"><div class="report-top"><span class="pill ${report.status === "جاهز" ? "success" : "warning"}">${report.status}</span><small class="num">${escapeHTML(report.id)}</small></div><h3>${escapeHTML(report.title)}</h3><p>${escapeHTML(report.branch)} · ${escapeHTML(report.date)}</p><div class="report-actions"><button class="btn btn-primary view-report" data-report="${escapeHTML(report.id)}">${ICONS.file} عرض التقرير</button></div></div></article>`; }).join("")}</div>`;
  };

  profilePage = function () {
    const p = state.profile || {};
    const email = state.session?.user?.email || "";
    const name = accountName();
    return `<div class="section-head"><div><h2>بيانات المريض</h2><p>بياناتك الأساسية المستخدمة في الحجز والتقارير.</p></div></div><div class="profile-grid"><aside class="card profile-summary"><div class="profile-photo">${escapeHTML(name.split(" ").slice(0, 2).map(x => x[0]).join(" "))}</div><h3>${escapeHTML(name)}</h3><p>Patient ID: <span class="num">${patientCode(p)}</span></p><div class="summary-box"><div class="summary-row"><span>الحجوزات</span><strong>${state.appointments.length}</strong></div><div class="summary-row"><span>التقارير</span><strong>${state.reports.length}</strong></div></div></aside><form class="card form-card" id="profile-form"><div class="form-grid"><div class="field"><label>الاسم بالكامل</label><input name="full_name" required value="${escapeHTML(p.full_name || "")}"></div><div class="field"><label>رقم الموبايل</label><input name="phone" inputmode="tel" value="${escapeHTML(p.phone || "")}"></div><div class="field"><label>تاريخ الميلاد</label><input name="birth_date" type="date" value="${escapeHTML(p.birth_date || "")}"></div><div class="field"><label>النوع</label><select name="gender"><option value="">غير محدد</option><option value="female" ${p.gender === "female" ? "selected" : ""}>أنثى</option><option value="male" ${p.gender === "male" ? "selected" : ""}>ذكر</option></select></div><div class="field full"><label>البريد الإلكتروني</label><input type="email" readonly value="${escapeHTML(email)}"></div><div class="field full"><label>ملاحظات مهمة قبل الفحص</label><textarea name="medical_notes" rows="3" placeholder="حساسية من الصبغة، حمل، منظم ضربات القلب...">${escapeHTML(p.medical_notes || "")}</textarea></div></div><div class="form-submit"><button class="btn btn-primary">حفظ البيانات</button></div></form></div>`;
  };

  patientsPage = function () {
    const rows = state.patients.map(p => `<tr><td><div class="table-person"><span class="mini-avatar">${escapeHTML((p.full_name || "م")[0])}</span><strong>${escapeHTML(p.full_name || "بدون اسم")}</strong></div></td><td class="num">${patientCode(p)}</td><td class="num">${escapeHTML(p.phone || "—")}</td><td>${escapeHTML(p.email || "—")}</td><td>${new Intl.DateTimeFormat("ar-EG").format(new Date(p.created_at))}</td></tr>`).join("");
    return `<div class="section-head"><div><h2>ملفات المرضى</h2><p>الحسابات المسجلة فعليًا في بوابة Perfect Scan.</p></div><button class="btn btn-primary" id="new-patient">+ مريض جديد</button></div><div class="card table-card"><div class="table-tools"><input class="mini-search" placeholder="ابحث بالاسم أو الرقم..."><span class="muted">${state.patients.length} مريض</span></div><table class="data-table"><thead><tr><th>المريض</th><th>Patient ID</th><th>الموبايل</th><th>البريد</th><th>تاريخ التسجيل</th></tr></thead><tbody>${rows || `<tr><td colspan="5">لا توجد حسابات مرضى بعد.</td></tr>`}</tbody></table></div>`;
  };

  function patientCreationModal() {
    const temporaryPassword = `Ps!${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}A7`;
    document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" id="modal"><div class="modal booking-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><span class="eyebrow">إدارة حسابات المرضى</span><h2>إنشاء حساب مريض جديد</h2></div><button class="close-btn close-modal">×</button></div><form id="create-patient-form"><div class="modal-body"><div class="form-grid"><div class="field"><label>اسم المريض بالكامل</label><input name="full_name" required minlength="3" autocomplete="off"></div><div class="field"><label>رقم الموبايل</label><input name="phone" required inputmode="tel" autocomplete="off" placeholder="01xxxxxxxxx"></div><div class="field"><label>البريد الإلكتروني</label><input name="email" required type="email" autocomplete="off" placeholder="patient@example.com"></div><div class="field"><label>كلمة مرور مؤقتة</label><input name="password" required type="text" minlength="10" value="${temporaryPassword}" dir="ltr"></div></div><div class="credential-note">المريض هيدخل بالكلمة المؤقتة مرة واحدة، وبعدها النظام هيطلب منه اختيار كلمة مرور جديدة.</div></div><div class="modal-foot"><button type="button" class="btn btn-ghost close-modal">إلغاء</button><button class="btn btn-primary">إنشاء حساب المريض</button></div></form></div></div>`);
    document.querySelectorAll(".close-modal").forEach(button => button.onclick = closeModal);
    document.getElementById("create-patient-form").onsubmit = createPatientAccount;
  }

  async function createPatientAccount(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const submit = formElement.querySelector(".btn-primary");
    const credentials = {
      full_name: form.get("full_name"),
      phone: form.get("phone"),
      email: form.get("email"),
      password: form.get("password")
    };
    submit.disabled = true;
    submit.textContent = "جاري إنشاء الحساب...";
    const { data, error } = await client.functions.invoke("create-patient", { body: credentials });
    if (error || data?.error) {
      let message = data?.error || error?.message || "تعذر إنشاء الحساب";
      try {
        const details = await error?.context?.json();
        message = details?.error || message;
      } catch { /* keep the available message */ }
      submit.disabled = false;
      submit.textContent = "إنشاء حساب المريض";
      return toast(message);
    }
    state.patients.unshift(data.patient);
    document.querySelector("#modal .modal-body").innerHTML = `<div class="success-message"><div class="success-check">✓</div><h3>تم إنشاء حساب ${escapeHTML(credentials.full_name)}</h3><p class="muted">سلّمي بيانات الدخول للمريض بطريقة آمنة. سيُطلب منه تغيير كلمة المرور عند أول دخول.</p><div class="credential-box"><span>البريد الإلكتروني<strong dir="ltr">${escapeHTML(credentials.email)}</strong></span><span>كلمة المرور المؤقتة<strong dir="ltr">${escapeHTML(credentials.password)}</strong></span></div></div>`;
    document.querySelector("#modal .modal-foot").innerHTML = `<button type="button" class="btn btn-primary close-modal">تم، إغلاق</button>`;
    document.querySelector("#modal .close-modal").onclick = () => { closeModal(); render(); };
  }

  adminAppointments = function () {
    const rows = state.appointments.map(a => { const p = state.patients.find(x => x.id === a.patientId); return `<tr><td class="num">#${a.bookingNo}</td><td><strong>${escapeHTML(p?.full_name || "مريض")}</strong></td><td>${escapeHTML(a.service)}</td><td>${escapeHTML(a.branch)}</td><td>${escapeHTML(a.dateLabel)} · ${escapeHTML(a.time)}</td><td><span class="pill ${a.rawStatus === "confirmed" ? "success" : ""}">${escapeHTML(a.status)}</span></td></tr>`; }).join("");
    return `<div class="section-head"><div><h2>حجوزات الفحوصات</h2><p>المواعيد المسجلة فعليًا في الفرعين.</p></div></div><div class="card table-card"><table class="data-table"><thead><tr><th>رقم الحجز</th><th>المريض</th><th>نوع الفحص</th><th>الفرع</th><th>الموعد</th><th>الحالة</th></tr></thead><tbody>${rows || `<tr><td colspan="6">لا توجد حجوزات بعد.</td></tr>`}</tbody></table></div>`;
  };

  adminReports = function () {
    const rows = state.reports.map(r => { const p = state.patients.find(x => x.id === r.patientId); return `<tr><td class="num">${escapeHTML(r.id)}</td><td><strong>${escapeHTML(p?.full_name || "مريض")}</strong></td><td>${escapeHTML(r.title)}</td><td>${escapeHTML(r.doctor)}</td><td><span class="pill ${r.status === "جاهز" ? "success" : "warning"}">${r.status}</span></td><td><button class="table-action view-report" data-report="${escapeHTML(r.id)}">عرض</button></td></tr>`; }).join("");
    return `<div class="section-head"><div><h2>إدارة تقارير الأشعة</h2><p>ارفعي التقرير واربطِيه بحساب المريض الصحيح.</p></div><button class="btn btn-primary" id="new-report">+ تقرير جديد</button></div><div class="card table-card"><table class="data-table"><thead><tr><th>رقم الفحص</th><th>المريض</th><th>الفحص</th><th>الطبيب</th><th>الحالة</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="6">لا توجد تقارير بعد.</td></tr>`}</tbody></table></div>`;
  };

  adminDashboard = function () {
    const today = new Date().toISOString().slice(0, 10);
    const todayAppointments = state.appointments.filter(a => a.date === today);
    return `<section class="admin-welcome"><div><span class="eyebrow">Perfect Scan Operations</span><h2>أهلاً يا ${escapeHTML(accountName())}</h2><p>متابعة البيانات الفعلية المسجلة في الفرعين.</p></div></section><section class="metric-grid">${[["فحوصات اليوم", todayAppointments.length, "حجوزات اليوم", ICONS.scan], ["تقارير جاهزة", state.reports.filter(r => r.status === "جاهز").length, "متاحة للمرضى", ICONS.file], ["المرضى", state.patients.length, "حسابات مسجلة", ICONS.users], ["كل الحجوزات", state.appointments.length, "منذ بدء النظام", ICONS.chart]].map(item => `<article class="card metric-card"><div class="metric-head"><span>${item[0]}</span><span class="metric-icon">${item[3]}</span></div><div class="metric-value num">${item[1]}</div><div class="metric-change">${item[2]}</div></article>`).join("")}</section><section class="dashboard-grid"><div class="card panel"><div class="panel-title"><h3>أحدث الحجوزات</h3><button class="table-action" data-page="admin-appointments">عرض الكل</button></div><div class="schedule-list">${state.appointments.slice(0, 5).map(a => `<div class="schedule-row"><span class="schedule-time">${escapeHTML(a.time)}</span><span class="mini-avatar">${escapeHTML(a.service[0])}</span><span class="schedule-info"><strong>${escapeHTML(a.service)}</strong><span>${escapeHTML(a.branch)} · ${escapeHTML(a.dateLabel)}</span></span><span class="pill ${a.rawStatus === "confirmed" ? "success" : ""}">${escapeHTML(a.status)}</span></div>`).join("") || `<p class="muted">لا توجد حجوزات حتى الآن.</p>`}</div></div><div class="card panel"><div class="panel-title"><h3>حماية بيانات المرضى</h3><span class="pill success">RLS Active</span></div><p class="muted">كل مريض يرى ملفه وحجوزاته وتقاريره المعتمدة فقط. ملفات التقارير محفوظة في مساحة خاصة.</p></div></section>`;
  };

  openBooking = function (preselectedService = null) {
    state.selectedService = preselectedService;
    state.selectedBranch = null;
    state.selectedDate = null;
    state.selectedDateLabel = null;
    state.selectedSlot = null;
    const dates = Array.from({ length: 5 }, (_, index) => {
      const d = new Date();
      d.setDate(d.getDate() + index + 1);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return [iso, new Intl.DateTimeFormat("ar-EG", { weekday: "long" }).format(d), new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long" }).format(d)];
    });
    const slots = ["11:00 ص", "12:30 م", "02:00 م", "03:30 م", "05:00 م", "06:30 م", "08:00 م", "09:30 م"];
    document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" id="modal"><div class="modal booking-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><span class="eyebrow">حجز فحص جديد</span><h2>اختار تفاصيل الموعد</h2></div><button class="close-btn close-modal">×</button></div><div class="modal-body"><section class="booking-section"><h3><span>1</span> نوع الفحص</h3><div class="booking-services">${SERVICES.map(s => `<button class="booking-service ${s.id === state.selectedService ? "selected" : ""}" data-book-service="${s.id}"><b>${s.icon}</b><span><strong>${s.name}</strong><small>${s.code} · ${s.duration}</small></span></button>`).join("")}</div></section><section class="booking-section"><h3><span>2</span> الفرع</h3><div class="booking-branches">${BRANCHES.map(b => `<button class="branch-option" data-book-branch="${b.id}"><span class="branch-pin">${ICONS.pin}</span><span><strong>${b.name}</strong><small>${b.address}</small></span></button>`).join("")}</div></section><section class="booking-section"><h3><span>3</span> اليوم والوقت</h3><div class="date-options">${dates.map(d => `<button class="date-option" data-date="${d[0]}" data-date-label="${d[1]}، ${d[2]}"><span>${d[1]}</span><strong>${d[2]}</strong></button>`).join("")}</div><div class="slot-grid">${slots.map(slot => `<button class="slot" data-book-slot="${slot}">${slot}</button>`).join("")}</div></section><div class="prep-note hidden" id="prep-note"></div><div class="booking-summary"><span>الفحص<strong id="summary-service">—</strong></span><span>الفرع<strong id="summary-branch">—</strong></span><span>الموعد<strong id="summary-date">—</strong></span></div></div><div class="modal-foot"><button class="btn btn-ghost close-modal">إلغاء</button><button class="btn btn-primary" id="confirm-booking" disabled>تأكيد الحجز</button></div></div></div>`);
    bindBookingModal();
    updateBookingSummary();
  };

  confirmBooking = async function () {
    const service = SERVICES.find(s => s.id === state.selectedService);
    const branch = BRANCHES.find(b => b.id === state.selectedBranch);
    const button = document.getElementById("confirm-booking");
    button.disabled = true;
    button.textContent = "جاري حفظ الحجز...";
    const { data, error } = await client.from("appointments").insert({
      patient_id: state.session.user.id,
      service_id: service.id,
      branch_id: branch.id,
      appointment_date: state.selectedDate,
      appointment_time: state.selectedSlot
    }).select().single();
    if (error) {
      button.disabled = false;
      button.textContent = "تأكيد الحجز";
      toast(`تعذر حفظ الحجز: ${error.message}`);
      return;
    }
    const booking = mapAppointment(data);
    state.appointments.unshift(booking);
    document.querySelector(".modal-body").innerHTML = `<div class="success-message"><div class="success-check">✓</div><h3>تم تأكيد موعد الفحص</h3><p class="muted">${service.name} في ${branch.name} — ${state.selectedDateLabel} الساعة ${state.selectedSlot}.</p><div class="summary-box"><div class="summary-row"><span>رقم الحجز</span><strong class="num">#${booking.bookingNo}</strong></div><div class="summary-row"><span>العنوان</span><strong>${branch.address}</strong></div><div class="summary-row"><span>التحضير</span><strong>${service.prep}</strong></div></div></div>`;
    document.querySelector(".modal-foot").innerHTML = `<button class="btn btn-ghost close-modal">العودة للرئيسية</button><button class="btn btn-primary" id="go-appointments">عرض مواعيدي</button>`;
    document.querySelector(".close-modal").onclick = closeModal;
    document.getElementById("go-appointments").onclick = () => { closeModal(); state.page = "appointments"; render(); };
  };

  openReport = function (id) {
    const report = state.reports.find(r => r.id === id);
    if (!report) return toast("التقرير غير موجود أو غير متاح لهذا الحساب");
    const service = SERVICES.find(s => s.id === report.serviceId) || SERVICES[0];
    const patient = state.patients.find(p => p.id === report.patientId);
    const name = patient?.full_name || accountName();
    document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" id="modal"><div class="modal report-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><span class="eyebrow">تقرير أشعة معتمد</span><h2>${escapeHTML(report.title)}</h2></div><button class="close-btn close-modal">×</button></div><div class="modal-body"><div class="report-sheet-head"><div class="report-logo"><img src="assets/perfect-scan-logo-transparent.png" alt="شعار برفكت سكان"></div><div><strong>${CENTER.arabicName}</strong><span>تحت إشراف ${CENTER.doctor}</span></div><span class="pill success">معتمد</span></div><div class="report-meta"><span>رقم الفحص<strong class="num">${escapeHTML(report.id)}</strong></span><span>المريض<strong>${escapeHTML(name)}</strong></span><span>نوع الفحص<strong>${escapeHTML(service.name)}</strong></span><span>التاريخ<strong>${escapeHTML(report.date)}</strong></span></div><div class="report-section"><h3>وصف الفحص والنتائج</h3><p>${escapeHTML(report.finding)}</p></div><div class="report-section impression"><h3>الانطباع التشخيصي</h3><p>${escapeHTML(report.impression)}</p></div><div class="doctor-sign"><span>تمت المراجعة والاعتماد بواسطة</span><strong>${escapeHTML(report.doctor)}</strong><small>استشاري الأشعة التشخيصية</small></div></div><div class="modal-foot">${report.filePath ? `<button class="btn btn-primary download-report">${ICONS.download} فتح ملف التقرير</button>` : `<span class="muted">لم يتم رفع ملف PDF لهذا التقرير.</span>`}</div></div></div>`);
    document.querySelector(".close-modal").onclick = closeModal;
    document.getElementById("modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
    document.querySelector(".download-report")?.addEventListener("click", () => openPrivateFile(report.filePath));
  };

  function reportUploadModal() {
    if (!state.patients.length) return toast("لازم يكون فيه حساب مريض واحد على الأقل قبل رفع التقرير");
    const now = new Date();
    const code = `PS-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Math.floor(100 + Math.random() * 900)}`;
    document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" id="modal"><div class="modal booking-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><span class="eyebrow">ملف المريض الرقمي</span><h2>رفع تقرير أشعة جديد</h2></div><button class="close-btn close-modal">×</button></div><form id="report-upload-form"><div class="modal-body"><div class="form-grid"><div class="field"><label>المريض</label><select name="patient_id" required><option value="">اختاري المريض</option>${state.patients.map(p => `<option value="${p.id}">${escapeHTML(p.full_name)} — ${patientCode(p)}</option>`).join("")}</select></div><div class="field"><label>رقم التقرير</label><input name="report_code" required value="${code}"></div><div class="field"><label>نوع الفحص</label><select name="service_id" required>${SERVICES.map(s => `<option value="${s.id}">${s.name}</option>`).join("")}</select></div><div class="field"><label>الفرع</label><select name="branch_id" required>${BRANCHES.map(b => `<option value="${b.id}">${b.name}</option>`).join("")}</select></div><div class="field full"><label>عنوان الفحص</label><input name="title" required placeholder="مثال: رنين مغناطيسي على الركبة اليمنى"></div><div class="field"><label>تاريخ الفحص</label><input name="exam_date" type="date" required value="${now.toISOString().slice(0, 10)}"></div><div class="field"><label>ملف التقرير</label><input name="report_file" type="file" required accept="application/pdf,image/jpeg,image/png"></div><div class="field full"><label>وصف الفحص والنتائج</label><textarea name="findings" rows="4" required></textarea></div><div class="field full"><label>الانطباع التشخيصي</label><textarea name="impression" rows="3" required></textarea></div></div></div><div class="modal-foot"><button type="button" class="btn btn-ghost close-modal">إلغاء</button><button class="btn btn-primary">رفع واعتماد التقرير</button></div></form></div></div>`);
    document.querySelectorAll(".close-modal").forEach(button => button.onclick = closeModal);
    document.getElementById("report-upload-form").onsubmit = uploadReport;
  }

  async function uploadReport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("button[type='submit'], .modal-foot .btn-primary");
    submit.disabled = true;
    submit.textContent = "جاري رفع التقرير...";
    const data = new FormData(form);
    const file = data.get("report_file");
    const patientId = data.get("patient_id");
    const safeName = String(file.name).replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${patientId}/${crypto.randomUUID()}-${safeName}`;
    const upload = await client.storage.from("reports").upload(path, file, { contentType: file.type, upsert: false });
    if (upload.error) {
      submit.disabled = false;
      submit.textContent = "رفع واعتماد التقرير";
      return toast(`تعذر رفع الملف: ${upload.error.message}`);
    }
    const payload = {
      report_code: data.get("report_code"), patient_id: patientId,
      service_id: data.get("service_id"), branch_id: data.get("branch_id"),
      title: data.get("title"), exam_date: data.get("exam_date"),
      findings: data.get("findings"), impression: data.get("impression"),
      doctor_name: CENTER.doctor, status: "ready", file_path: path
    };
    const inserted = await client.from("reports").insert(payload).select().single();
    if (inserted.error) {
      await client.storage.from("reports").remove([path]);
      submit.disabled = false;
      submit.textContent = "رفع واعتماد التقرير";
      return toast(`تعذر حفظ التقرير: ${inserted.error.message}`);
    }
    state.reports.unshift(mapReport(inserted.data));
    closeModal();
    toast("تم رفع التقرير وأصبح متاحًا للمريض");
    render();
  }

  async function openPrivateFile(path) {
    const { data, error } = await client.storage.from("reports").createSignedUrl(path, 300);
    if (error) return toast(`تعذر فتح الملف: ${error.message}`);
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function authErrorMessage(error) {
    if (!error) return "حدث خطأ غير متوقع";
    if (error.message.includes("Invalid login credentials")) return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
    if (error.message.includes("Email not confirmed")) return "من فضلك أكدي البريد الإلكتروني من الرسالة المرسلة ليك.";
    if (error.message.includes("already registered")) return "البريد الإلكتروني مسجل بالفعل، استخدمي تسجيل الدخول.";
    return error.message;
  }

  async function handleAuth(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.busy = true;
    state.authMessage = "";
    render();
    const { data: result, error } = await client.auth.signInWithPassword({
      email: data.get("email"),
      password: data.get("password")
    });
    state.busy = false;
    if (error) {
      state.authMessage = authErrorMessage(error);
      return render();
    }
    await hydrate(result.session);
  }

  async function loadData() {
    state.dataError = "";
    const userId = state.session.user.id;
    const profileResult = await client.from("profiles").select("*").eq("id", userId).single();
    if (profileResult.error) {
      state.dataError = `تعذر قراءة جدول profiles: ${profileResult.error.message}`;
      state.role = null;
      return;
    }
    state.profile = profileResult.data;
    state.role = profileResult.data.role;
    state.page = state.role === "admin" ? "dashboard" : "home";

    const [appointmentsResult, reportsResult] = await Promise.all([
      client.from("appointments").select("*").order("appointment_date", { ascending: false }),
      client.from("reports").select("*").order("exam_date", { ascending: false })
    ]);
    if (appointmentsResult.error || reportsResult.error) {
      state.dataError = appointmentsResult.error?.message || reportsResult.error?.message || "تعذر تحميل البيانات";
    }
    state.appointments = (appointmentsResult.data || []).map(mapAppointment);
    state.reports = (reportsResult.data || []).map(mapReport);

    if (state.role === "admin") {
      const patientsResult = await client.from("profiles").select("*").eq("role", "patient").order("created_at", { ascending: false });
      if (patientsResult.error) state.dataError = patientsResult.error.message;
      state.patients = patientsResult.data || [];
    } else {
      state.patients = [];
    }
  }

  async function hydrate(session) {
    state.session = session;
    state.mustChangePassword = session.user?.user_metadata?.must_change_password === true;
    state.loading = true;
    render();
    await loadData();
    if (state.role && state.role !== portalType) {
      const attemptedRole = state.role;
      await client.auth.signOut();
      Object.assign(state, {
        session: null,
        profile: null,
        role: null,
        appointments: [],
        reports: [],
        patients: [],
        loading: false,
        mustChangePassword: false,
        authMessage: attemptedRole === "admin"
          ? "ده حساب إدارة. استخدمي صفحة دخول الإدارة."
          : "هذه الصفحة للإدارة فقط. استخدم صفحة دخول المريض."
      });
      render();
      return;
    }
    state.loading = false;
    render();
  }

  async function logout() {
    await client.auth.signOut();
    Object.assign(state, { session: null, profile: null, role: null, appointments: [], reports: [], patients: [], page: "home", dataError: "", loading: false, mustChangePassword: false });
    render();
  }

  async function saveProfile(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      full_name: form.get("full_name"), phone: form.get("phone") || null,
      birth_date: form.get("birth_date") || null, gender: form.get("gender") || null,
      medical_notes: form.get("medical_notes") || null
    };
    const { data, error } = await client.from("profiles").update(payload).eq("id", state.session.user.id).select().single();
    if (error) return toast(`تعذر حفظ البيانات: ${error.message}`);
    state.profile = data;
    toast("تم حفظ بيانات المريض");
    render();
  }

  async function changeTemporaryPassword(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    if (password !== form.get("password_confirm")) {
      state.authMessage = "كلمتا المرور غير متطابقتين.";
      return render();
    }
    state.busy = true;
    state.authMessage = "";
    render();
    const metadata = { ...(state.session.user.user_metadata || {}), must_change_password: false };
    const { data, error } = await client.auth.updateUser({ password, data: metadata });
    state.busy = false;
    if (error) {
      state.authMessage = authErrorMessage(error);
      return render();
    }
    state.session.user = data.user;
    state.mustChangePassword = false;
    toast("تم تغيير كلمة المرور بنجاح");
    render();
  }

  bindEvents = function () {
    document.getElementById("auth-form")?.addEventListener("submit", handleAuth);
    document.getElementById("change-password-form")?.addEventListener("submit", changeTemporaryPassword);
    document.getElementById("logout-button")?.addEventListener("click", logout);
    document.querySelectorAll("[data-page]").forEach(button => button.onclick = () => { state.page = button.dataset.page; render(); window.scrollTo(0, 0); });
    document.querySelectorAll("[data-open-booking]").forEach(button => button.onclick = () => openBooking());
    document.querySelectorAll("[data-service-book]").forEach(button => button.onclick = () => openBooking(button.dataset.serviceBook));
    document.querySelectorAll(".view-report").forEach(button => button.onclick = () => openReport(button.dataset.report));
    document.querySelectorAll(".cancel-booking").forEach(button => button.onclick = async () => {
      button.disabled = true;
      const { error } = await client.rpc("cancel_my_appointment", { appointment_id: button.dataset.id });
      if (error) return toast(`تعذر إلغاء الموعد: ${error.message}`);
      const item = state.appointments.find(a => a.id === button.dataset.id);
      if (item) { item.rawStatus = "cancelled"; item.status = "ملغي"; }
      toast("تم إلغاء الموعد");
      render();
    });
    document.getElementById("menu-toggle")?.addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
    document.getElementById("profile-form")?.addEventListener("submit", saveProfile);
    document.getElementById("new-report")?.addEventListener("click", reportUploadModal);
    document.getElementById("new-patient")?.addEventListener("click", patientCreationModal);
    document.getElementById("settings-form")?.addEventListener("submit", event => { event.preventDefault(); toast("إعدادات العرض فقط في النسخة الحالية"); });
  };

  render = function () {
    app.innerHTML = state.loading ? loadingView() : state.mustChangePassword ? passwordChangeView() : state.role ? shell() : roleEntry();
    bindEvents();
  };

  async function boot() {
    if (!client) {
      state.loading = false;
      state.authMessage = "تعذر تحميل اتصال Supabase. تأكدي من الإنترنت ثم أعيدي تحميل الصفحة.";
      return render();
    }
    render();
    const { data, error } = await client.auth.getSession();
    if (error) {
      state.loading = false;
      state.authMessage = authErrorMessage(error);
      return render();
    }
    if (data.session) return hydrate(data.session);
    state.loading = false;
    render();
  }

  client?.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && state.session) {
      Object.assign(state, { session: null, profile: null, role: null, appointments: [], reports: [], patients: [], loading: false });
      render();
    }
  });

  boot();
})();
