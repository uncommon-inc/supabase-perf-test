<script>
	let { data } = $props()
</script>

<div>
	<h1>Fetched customers: {data.companies.length}</h1>
	<ul>
		{#each data.companies as company (company.id)}
			<li class="list-disc">
				{company.id}
			</li>
		{/each}
	</ul>
</div>
