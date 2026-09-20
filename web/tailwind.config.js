export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        win: 'var(--win)',
        card: 'var(--card)',
        ink: 'var(--text)',
        ink2: 'var(--text2)',
        hair: 'var(--hair)',
        field: 'var(--field)',
        hov: 'var(--hover)',
        sel: 'var(--sel)',
        ok: 'var(--green)',
        bad: 'var(--red)',
        warn: 'var(--orange)',
        track: 'var(--track)',
        btn2: 'var(--btn2)',
        btn2h: 'var(--btn2-hi)',
        accent: 'var(--accent)',
        accenth: 'var(--accent-hi)'
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['"SF Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      borderRadius: { card: '10px', ctl: '8px', field: '7px' },
      transitionTimingFunction: { apple: 'cubic-bezier(.25,.46,.45,.94)' }
    }
  },
  plugins: []
}
