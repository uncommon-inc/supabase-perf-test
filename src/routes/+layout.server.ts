import { dev } from '$app/environment'
import type { LayoutServerLoad } from './$types'

// Disable JS on production builds to mitigate scripting/rendering overhead
export const csr = dev

export const load: LayoutServerLoad = async ({ locals: { safeGetSession }, cookies }) => {
	const { session } = await safeGetSession()
	return {
		session,
		cookies: cookies.getAll()
	}
}
