import type { createClient } from '@supabase/supabase-js'

export const SUPABASE_CONFIG: Parameters<typeof createClient>[2] = {
	global: {
		headers: {
			'sb-lb-routing-mode': 'alpha-all-services'
		}
	}
	// realtime: {
	// 	fetch: fetch
	// }
}
