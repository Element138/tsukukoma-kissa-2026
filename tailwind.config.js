/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--tw-border))",
        input: "hsl(var(--tw-input))",
        ring: "hsl(var(--tw-ring))",
        background: "hsl(var(--tw-background))",
        foreground: "hsl(var(--tw-foreground))",
        primary: {
          DEFAULT: "hsl(var(--tw-primary))",
          foreground: "hsl(var(--tw-primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--tw-secondary))",
          foreground: "hsl(var(--tw-secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--tw-destructive))",
          foreground: "hsl(var(--tw-destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--tw-muted))",
          foreground: "hsl(var(--tw-muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--tw-accent))",
          foreground: "hsl(var(--tw-accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--tw-popover))",
          foreground: "hsl(var(--tw-popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--tw-card))",
          foreground: "hsl(var(--tw-card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
}
