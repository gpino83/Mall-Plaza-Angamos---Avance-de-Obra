// =========================================================
// CONFIGURACIÓN SUPABASE
// Reemplaza estos dos valores con los de tu proyecto:
// Supabase Dashboard > Settings > API
// =========================================================
const SUPABASE_URL = "https://cghkzzumkpqlpufuhusf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_5t5OwzJCM1_Rz5HbsnW44Q_64d4u_jq";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
