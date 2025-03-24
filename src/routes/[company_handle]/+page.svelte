<script lang="ts">
	let { data } = $props()
	let { user } = $derived(data)
</script>

<h1>Private page for user: {user?.email}</h1>
<h2>{data.company.id}</h2>
