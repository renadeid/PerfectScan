import { withSupabase } from "jsr:@supabase/server@^1";

const allowedOrigins = new Set([
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "https://renadeid.github.io"
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://renadeid.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" }
  });
}

const createPatient = withSupabase({ auth: "user" }, async (request, context) => {
  const { data: caller, error: callerError } = await context.supabase
    .from("profiles")
    .select("role")
    .eq("id", context.userClaims?.sub)
    .single();

  if (callerError || caller?.role !== "admin") {
    return json(request, { error: "غير مسموح: حساب Admin فقط يمكنه إنشاء المرضى." }, 403);
  }

  let payload: { full_name?: string; phone?: string; email?: string; password?: string };
  try {
    payload = await request.json();
  } catch {
    return json(request, { error: "بيانات الطلب غير صحيحة." }, 400);
  }

  const fullName = payload.full_name?.trim() || "";
  const phone = payload.phone?.trim() || "";
  const email = payload.email?.trim().toLowerCase() || "";
  const password = payload.password || "";

  if (fullName.length < 3 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10) {
    return json(request, { error: "أدخلي اسمًا صحيحًا، بريدًا صحيحًا، وكلمة مرور مؤقتة من 10 أحرف على الأقل." }, 400);
  }

  const { data: created, error: createError } = await context.supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone, must_change_password: true }
  });

  if (createError || !created.user) {
    const duplicate = createError?.message?.toLowerCase().includes("already") || createError?.message?.toLowerCase().includes("registered");
    return json(request, { error: duplicate ? "البريد الإلكتروني مسجل بالفعل." : createError?.message || "تعذر إنشاء حساب المريض." }, 400);
  }

  const { data: profile } = await context.supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", created.user.id)
    .single();

  return json(request, {
    patient: profile || {
      id: created.user.id,
      full_name: fullName,
      email,
      phone,
      role: "patient",
      patient_no: null,
      created_at: created.user.created_at
    }
  }, 201);
});

export default {
  fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders(request) });
    }
    if (request.method !== "POST") {
      return json(request, { error: "Method not allowed" }, 405);
    }
    return createPatient(request);
  }
};
