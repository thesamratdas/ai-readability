const GRADE_COLOR = {
  A: '#4c1',
  B: '#97ca00',
  C: '#dfb317',
  D: '#fe7d37',
  F: '#e05d44',
};

export function makeBadge(grade, score) {
  const color = GRADE_COLOR[grade] ?? '#9f9f9f';
  // Label "AI-Readability" (~14 chars) + value "A" (1 char)
  const lw = 112, vw = 28, w = lw + vw;
  const lx = Math.floor(lw / 2);
  const vx = lw + Math.floor(vw / 2);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="AI-Readability: ${grade}">`,
    `  <title>AI-Readability: ${grade} (score ${score}/100)</title>`,
    `  <linearGradient id="g" x2="0" y2="100%">`,
    `    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>`,
    `    <stop offset="1" stop-opacity=".1"/>`,
    `  </linearGradient>`,
    `  <clipPath id="c"><rect width="${w}" height="20" rx="3"/></clipPath>`,
    `  <g clip-path="url(#c)">`,
    `    <rect width="${lw}" height="20" fill="#555"/>`,
    `    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>`,
    `    <rect width="${w}" height="20" fill="url(#g)"/>`,
    `  </g>`,
    `  <g fill="#fff" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11" text-anchor="middle">`,
    `    <text x="${lx}" y="15" fill="#010101" fill-opacity=".3">AI-Readability</text>`,
    `    <text x="${lx}" y="14">AI-Readability</text>`,
    `    <text x="${vx}" y="15" fill="#010101" fill-opacity=".3" font-weight="bold">${grade}</text>`,
    `    <text x="${vx}" y="14" font-weight="bold">${grade}</text>`,
    `  </g>`,
    `</svg>`,
  ].join('\n');
}
