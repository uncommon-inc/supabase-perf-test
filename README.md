# Investigation notes

Based on customer use-case and code samples. 

### Setup

- 1 x Primary in NA
- 2 x Read Replica in EU

Using following guide – https://supabase.com/docs/guides/getting-started/tutorials/with-sveltekit?queryGroups=database-method&database-method=sql

Get Load Balancer URL (ending with `-all`)

`.env`

```
# Update these with your Supabase details from your project settings > API
PUBLIC_SUPABASE_URL=https://<project_ref>-all.supabase.co
PUBLIC_SUPABASE_ANON_KEY=...

SUPABASE_PROJECT=<project_ref>-all
SUPABASE_JWT_SECRET=...
```

Use [experimental routing](https://supabase.com/docs/guides/platform/read-replicas#experimental-routing) for RR. 

⚠️ **NB!** If you use a [custom domain](https://supabase.com/docs/guides/platform/custom-domains), requests will not be routed through the load balancer.

`$lib/constants.ts`

```tsx
export const SUPABASE_CONFIG: Parameters<typeof createClient>[2] = {
	global: {
		fetch,
		headers: {
			// https://supabase.com/docs/guides/platform/read-replicas#experimental-routing
			// If you use a custom domain, requests will not be routed through the load balancer. You should instead use the dedicated endpoints provided in the dashboard.
			'sb-lb-routing-mode': 'alpha-all-services'
		}
	},
	realtime: {
		fetch: fetch
	}
};
```

`+layout.ts`

Since we are using API LB URL above it will allow round-robin for Read Replicas. Of course because there is no geo-routing (**yet**) ****latency will be a bit random because depending where caller client is their Data API query will go to either primary or to one of the RRs. 

When geo-routing will come out it will be more like sticky session and will go to closer RR but for now it is round-robin so it is better to have enough RRs distributed across the regions (i.e. Europe, Singapore, NA).

Also it is better to use experimental routing both on client and server sides, because both can perform Data API queries.

```tsx
// src/routes/+layout.ts
import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import type { LayoutLoad } from './$types';
import { SUPABASE_CONFIG } from '$lib/constants';

export const load: LayoutLoad = async ({ fetch, data, depends }) => {
	depends('supabase:auth');

	// Using experimental routing for both browser and server clients
	const config = {
		...SUPABASE_CONFIG
	};

	const supabase = isBrowser()
		? createBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, config)
		: createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				...SUPABASE_CONFIG,
				cookies: {
					getAll() {
						return data.cookies;
					}
				}
			});

	/**
	 * It's fine to use `getSession` here, because on the client, `getSession` is
	 * safe, and on the server, it reads `session` from the `LayoutData`, which
	 * safely checked the session using `safeGetSession`.
	 */
	const {
		data: { session }
	} = await supabase.auth.getSession();

	return { supabase, session };
};
```

Auth calls to primary could be very expensive so doing session validation via `getUser()` can cause additional latency. Other calls which invoke `getUser()` are:

- `setSession()`
- `getUserIdentities(`

```tsx
const {
  data: { user },
	error
} = await event.locals.supabase.auth.getUser();
if (error) {
  // JWT validation has failed
	return { session: null, user: null };
}
```

`hooks.server.ts`

Since for now all auth requests gotta go to primary if caller client is far from that it will cause additional latency. It is not possible to forward auth requests to RR right now, so RR with experimental routing will be beneficial for fetching/updating data, but not auth. 

So we will try to replace `getUser()` call with “local validation” JWT therefore we need access token and JWT secret. 

Basically we will look at `Authorization` header, session cookie containing access token therefore we will be requesting `sb-<project_ref>-all-auth-token` cookie and existing session as fallback. 

Then we will run `jwt.verify()` locally instead of calling `getUser()` which will save us one roundtrip. 

```tsx
// src/hooks.server.ts
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { createServerClient } from '@supabase/ssr';
import type { Handle } from '@sveltejs/kit';

import jwt from 'jsonwebtoken';
import { SUPABASE_CONFIG } from '$lib/constants';
import { SUPABASE_JWT_SECRET, SUPABASE_PROJECT } from '$env/static/private';

export const handle: Handle = async ({ event, resolve }) => {
	const config = {
		...SUPABASE_CONFIG,
		cookies: {
			getAll: () => event.cookies.getAll(),
			/**
			 * SvelteKit's cookies API requires `path` to be explicitly set in
			 * the cookie options. Setting `path` to `/` replicates previous/
			 * standard behavior.
			 */
			setAll: (cookiesToSet) => {
				cookiesToSet.forEach(({ name, value, options }) => {
					event.cookies.set(name, value, { ...options, path: '/' });
				});
			}
		}
	};

	event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, config);

	/**
	 * Unlike `supabase.auth.getSession()`, which returns the session _without_
	 * validating the JWT, this function also calls `getUser()` to validate the
	 * JWT before returning the session.
	 */
	event.locals.safeGetSession = async () => {
		let user = null;

		const header_token = event.request.headers.get('Authentication')?.split(' ')[1];

		const decodedCookie =
			Buffer.from(
				event.cookies.get(`sb-${SUPABASE_PROJECT}-auth-token`)?.replace(/^base64-/, '') || '',
				'base64'
			).toString('utf-8') || '{}';
		const cookie_token = JSON.parse(decodedCookie)?.access_token;

		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();
		const session_token = session?.access_token;

		const token = header_token ?? cookie_token ?? session_token;
		if (!session || !token) {
			return { session: null, user };
		}

		try {
			const decoded = jwt.verify(token, SUPABASE_JWT_SECRET);
			user = decoded;
		} catch (error) {
			console.error('Failed to verify token', error);
			return { session: null, user };
		}

		return { session, user };
	};

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};

```

This is not necessary since it is modifying browser to server request and not server to subapase request. `sb-lb-routing-mode` header should be set when supabase client is being created.

```tsx
	// event.setHeaders({
	// 	'sb-lb-routing-mode': 'alpha-all-services'
	// });
```

What worth to pay attention to is the difference in response between `getUser()` and decoded JWT token:

**getUser()**

```tsx
{
  id: '6dfd040a-ea53-4400-b1c8-f196e3d9b2df',

  aud: 'authenticated',
  role: 'authenticated',
  email: 'mischa.lieibenson@supabase.com',
  email_confirmed_at: '2025-03-21T10:23:05.691098Z',
  phone: '',
  confirmation_sent_at: '2025-03-21T10:22:40.243598Z',
  confirmed_at: '2025-03-21T10:23:05.691098Z',
  last_sign_in_at: '2025-03-21T10:23:05.694278Z',
  app_metadata: { provider: 'email', providers: [ 'email' ] },
  user_metadata: {
    email: 'mischa.lieibenson@supabase.com',
    email_verified: true,
    phone_verified: false,
    sub: '6dfd040a-ea53-4400-b1c8-f196e3d9b2df'
  },
  identities: [
    {
      identity_id: '3621957e-c37e-4b79-b526-62af79c5e0c5',
      id: '6dfd040a-ea53-4400-b1c8-f196e3d9b2df',
      user_id: '6dfd040a-ea53-4400-b1c8-f196e3d9b2df',
      identity_data: [Object],
      provider: 'email',
      last_sign_in_at: '2025-03-21T10:22:40.239621Z',
      created_at: '2025-03-21T10:22:40.239671Z',
      updated_at: '2025-03-21T10:22:40.239671Z',
      email: 'mischa.lieibenson@supabase.com'
    }
  ],
  created_at: '2025-03-21T10:22:40.233955Z',
  updated_at: '2025-03-21T11:21:38.817635Z',
  is_anonymous: false
}
```

**decoded JWT token**

```tsx
{
  sub: '6dfd040a-ea53-4400-b1c8-f196e3d9b2df',

  aud: 'authenticated',
  role: 'authenticated',
  email: 'mischa.lieibenson@supabase.com',

  phone: '',

  app_metadata: { provider: 'email', providers: [ 'email' ] },
  user_metadata: {
    email: 'mischa.lieibenson@supabase.com',
    email_verified: true,
    phone_verified: false,
    sub: '6dfd040a-ea53-4400-b1c8-f196e3d9b2df'
  },

  is_anonymous: false

  session_id: '21bbb527-8f03-44ef-aefb-9475ce1d09b9',
  aal: 'aal1',
  amr: [ { method: 'otp', timestamp: 1742552585 } ],
  iss: 'https://<project_ref>.supabase.co/auth/v1',
  exp: 1742559698,
  iat: 1742556098,
}
```

It should contain enough information to perform queries but if you need extra claims added you might consider Auth Hooks, i.e. [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook?queryGroups=language&language=sql).

### Observation

By performing steps above i observed ~5x improvement in latency.