// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
// See https://kit.svelte.dev/docs/types#app
// See https://kit.svelte.dev/docs/types#app
	declare namespace App {
		interface Locals {
		userId: string | null;
		isAdmin: boolean;
		}
	}
  
}

export {};
