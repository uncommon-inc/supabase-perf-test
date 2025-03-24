// Types
import type { PageServerLoad } from './$types'

// Utils
import { error } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const { data: companies, error: companiesError } = await supabase
		.from('companies')
		.select('*')
		.limit(5)

	if (companiesError) {
		console.error('Error fetching companies:', companiesError)
		error(500, companiesError.message)
	}

	console.log(companies)

	return { companies: companies ?? [] }
}
