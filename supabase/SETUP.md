# Supabase setup for Perfect Scan

1. Open the Supabase project.
2. Open **SQL Editor** and choose **New query**.
3. Paste all of `schema.sql`, then press **Run** once.
4. Open **Authentication → Providers → Email** and keep Email enabled.
5. Create your own account from the Perfect Scan website.
6. Promote that account to admin by running this in SQL Editor, replacing the email:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'YOUR-EMAIL@example.com');
```

Patients can register from the site or be created by an Admin. They always start
with the `patient` role. Only an existing admin can see all patients,
appointments, and reports. Report files are stored in the private `reports`
bucket and are never public.

## Deploy the secure patient-creation function

The Admin dashboard's **New patient** action uses a server-side Edge Function, so
the privileged key never reaches the browser. Deploy it with the Supabase CLI:

```bash
npx supabase login
npx supabase functions deploy create-patient --project-ref atekifwpfjgfvnsaytad --use-api
```

The function verifies the signed-in caller against `profiles.role = 'admin'`
before it creates a patient. New patients must change the temporary password on
their first login.
