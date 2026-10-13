/** Prepares text for TTS: strips markdown/LaTeX noise and verbalises common math notation (fr/en). */
const DICT = {
  fr: { frac: (a: string, b: string) => ` ${a} sur ${b} `, sqrt: (a: string) => ` racine carrée de ${a} `, times: ' fois ', div: ' divisé par ', eq: ' égale ', leq: ' inférieur ou égal à ', geq: ' supérieur ou égal à ', neq: ' différent de ', pi: ' pi ', infty: ' infini ', plusminus: ' plus ou moins ', sum: ' somme ', int: ' intégrale ', sq: ' au carré', cube: ' au cube', pow: ' puissance ', plus: ' plus ', minus: ' moins ' },
  en: { frac: (a: string, b: string) => ` ${a} over ${b} `, sqrt: (a: string) => ` square root of ${a} `, times: ' times ', div: ' divided by ', eq: ' equals ', leq: ' less than or equal to ', geq: ' greater than or equal to ', neq: ' not equal to ', pi: ' pi ', infty: ' infinity ', plusminus: ' plus or minus ', sum: ' sum ', int: ' integral ', sq: ' squared', cube: ' cubed', pow: ' to the power of ', plus: ' plus ', minus: ' minus ' },
} as const;

export function normalizeForSpeech(input: string, language = 'fr'): string {
  const d = DICT[language === 'en' ? 'en' : 'fr'];
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\$\$?([^$]+)\$\$?/g, '$1')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_m, a, b) => d.frac(a, b))
    .replace(/\\sqrt\{([^{}]+)\}/g, (_m, a) => d.sqrt(a))
    .replace(/\\times|×|\\cdot/g, d.times).replace(/\\div|÷/g, d.div)
    .replace(/\\leq?|≤/g, d.leq).replace(/\\geq?|≥/g, d.geq).replace(/\\neq|≠/g, d.neq)
    .replace(/\\pi|π/g, d.pi).replace(/\\infty|∞/g, d.infty).replace(/\\pm|±/g, d.plusminus)
    .replace(/\\sum|∑/g, d.sum).replace(/\\int|∫/g, d.int)
    .replace(/\^2\b/g, d.sq).replace(/\^3\b/g, d.cube)
    .replace(/\^\{?([A-Za-z0-9+-]+)\}?/g, (_m, p) => `${d.pow}${p} `)
    .replace(/(?<=\w)\s*=\s*(?=\w)/g, d.eq)
    .replace(/(?<=\d)\s*\+\s*(?=\d|[a-z])/gi, d.plus)
    .replace(/(?<=[\w)])\s+-\s+(?=[\w(])/g, d.minus)
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}_#>*~|]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ').trim();
}
