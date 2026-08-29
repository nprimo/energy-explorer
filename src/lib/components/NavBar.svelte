<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	const links = [
		{ route: '/', label: 'Data explorer' },
		{ route: '/consumption', label: 'Daily average' }
	];
</script>

<nav>
	<ul>
		{#each links as link (link.route)}
			{@const href = resolve(link.route)}
			<li>
				<a {href} aria-current={page.url.pathname === href ? 'page' : undefined}>
					{link.label}
				</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	nav {
		border-bottom: 1px solid #e5e7eb;
	}

	ul {
		display: flex;
		gap: 1.5rem;
		margin: 0;
		padding: 0.75rem 1.5rem;
		list-style: none;
	}

	a {
		color: #6b7280;
		text-decoration: none;
		font-weight: 500;
	}

	a:hover {
		color: #111827;
	}

	a[aria-current='page'] {
		color: #111827;
		border-bottom: 2px solid #111827;
	}
</style>
