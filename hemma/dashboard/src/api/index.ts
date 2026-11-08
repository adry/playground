import { demoApi } from './demo';
import { liveApi } from './live';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const demo = url && key ? null : demoApi();
export const api = url && key ? liveApi(url, key) : demo!;
