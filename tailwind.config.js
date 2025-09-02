/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: [
      './src/**/*.{svelte,ts,js}',
      './src/routes/**/*.{svelte,ts}',
      './src/lib/**/*.{svelte,ts,js}'
    ],
    theme: { extend: {} },
    plugins: []
  };
  