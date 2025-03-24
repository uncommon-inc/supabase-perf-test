import { createServerClient } from '@supabase/ssr'
import { type Handle, redirect } from '@sveltejs/kit'
import { sequence } from '@sveltejs/kit/hooks'

import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { SUPABASE_JWT_SECRET, SUPABASE_PROJECT } from '$env/static/private'

import jwt from 'jsonwebtoken'

const supabase: Handle = async ({ event, resolve }) => {
	/**
	 * Creates a Supabase client specific to this server request.
	 *
	 * The Supabase client gets the Auth token from the request cookies.
	 */
	event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			/**
			 * SvelteKit's cookies API requires `path` to be explicitly set in
			 * the cookie options. Setting `path` to `/` replicates previous/
			 * standard behavior.
			 */
			setAll: (cookiesToSet) => {
				cookiesToSet.forEach(({ name, value, options }) => {
					event.cookies.set(name, value, { ...options, path: '/' })
				})
			}
		}
	})

	/**
	 * Unlike `supabase.auth.getSession()`, which returns the session _without_
	 * validating the JWT, this function also calls `getUser()` to validate the
	 * JWT before returning the session.
	 */
	// event.locals.safeGetSession = async () => {
	// 	const {
	// 		data: { session }
	// 	} = await event.locals.supabase.auth.getSession()
	// 	if (!session) {
	// 		return { session: null, user: null }
	// 	}

	// 	const {
	// 		data: { user },
	// 		error
	// 	} = await event.locals.supabase.auth.getUser()
	// 	if (error) {
	// 		// JWT validation has failed
	// 		return { session: null, user: null }
	// 	}

	// 	return { session, user }
	// }
	event.locals.safeGetSession = async () => {
		let user = null

		const header_token = event.request.headers.get('Authentication')?.split(' ')[1]

		const decodedCookie =
			Buffer.from(
				event.cookies.get(`sb-${SUPABASE_PROJECT}-auth-token`)?.replace(/^base64-/, '') || '',
				'base64'
			).toString('utf-8') || '{}'
		const cookie_token = JSON.parse(decodedCookie)?.access_token

		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession()
		const session_token = session?.access_token

		const token = header_token ?? cookie_token ?? session_token
		if (!session || !token) {
			return { session: null, user }
		}

		try {
			const decoded = jwt.verify(token, SUPABASE_JWT_SECRET)
			user = decoded
		} catch (error) {
			console.error('Failed to verify token', error)
			return { session: null, user }
		}

		return { session, user }
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			/**
			 * Supabase libraries use the `content-range` and `x-supabase-api-version`
			 * headers, so we need to tell SvelteKit to pass it through.
			 */
			return name === 'content-range' || name === 'x-supabase-api-version'
		}
	})
}

const authGuard: Handle = async ({ event, resolve }) => {
	const { session, user } = await event.locals.safeGetSession()
	event.locals.session = session
	event.locals.user = user

	if (!event.locals.session && event.url.pathname.startsWith('/private')) {
		redirect(303, '/auth')
	}

	if (event.locals.session && event.url.pathname === '/auth') {
		redirect(303, '/private')
	}

	return resolve(event)
}

export const handle: Handle = sequence(supabase, authGuard)
