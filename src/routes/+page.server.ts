// Types
import type { PageServerLoad } from './$types'

// Utils
import { error } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const start = performance.now()

	const { data: companies, error: companiesError } = await supabase
		.from('companies')
		.select('*')
		.limit(5)

	if (companiesError) {
		console.error('Error fetching companies:', companiesError)
		error(500, companiesError.message)
	}

	const end = performance.now()
	const duration = end - start

	console.log(`Time taken to fetch ${companies.length} companies: ${duration}ms`)

	// This returns 0 companies when using the load balancer url
	return { companies: companies ?? [] }
}
