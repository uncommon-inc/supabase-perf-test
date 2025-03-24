/**
 * This file is necessary to ensure protection of all routes in the `private`
 * directory. It makes the routes in this directory _dynamic_ routes, which
 * send a server request, and thus trigger `hooks.server.ts`.
 **/
import { error } from '@sveltejs/kit'
// Types
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals: { supabase }, params }) => {
	const { company_handle } = params
	const start = performance.now()

	const { data: companyData, error: companyError } = await supabase
		.from('companies')
		.select('id')
		.eq('company_handle', company_handle)

	const end = performance.now()
	const duration = end - start

	if (companyError) {
		console.error(companyError)
		error(404, 'Company not found')
	}

	console.log(`Time taken to fetch company (${company_handle}): ${duration}ms`)

	return { company: companyData }
}
