export function normalizeForSpeech(text: string, lang = 'fr'): string {
  if (!text) return '';
  let out = text;

  // Code blocks & markdown stripping
  out = out.replace(/```[\s\S]*?```/g, ' ');
  out = out.replace(/https?:\/\/\S+/g, ' ');
  out = out.replace(/\*\*(.*?)\*\*/g, '$1');
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  if (lang === 'en') {
    out = out.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 over $2');
  } else {
    out = out.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 sur $2');
  }

  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => latexToSpeech(math, lang));
  out = out.replace(/\$([^$]+)\$/g, (_, math) => latexToSpeech(math, lang));

  if (lang === 'en') {
    out = out.replace(/\\sqrt\{([^}]+)\}/g, 'square root of $1');
    out = out.replace(/([a-zA-Z0-9])\^2/g, '$1 squared');
    out = out.replace(/([a-zA-Z0-9])\^([0-9a-zA-Z]+)/g, '$1 to the power of $2');
  } else {
    out = out.replace(/\\sqrt\{([^}]+)\}/g, 'racine carrée de $1');
    out = out.replace(/([a-zA-Z0-9])\^2/g, '$1 au carré');
    out = out.replace(/([a-zA-Z0-9])\^([0-9a-zA-Z]+)/g, '$1 puissance $2');
  }

  out = out.replace(/\\times/g, lang === 'en' ? ' times ' : ' fois ');
  out = out.replace(/\\cdot/g, lang === 'en' ? ' times ' : ' fois ');
  out = out.replace(/[#*_~`]/g, ' ');
  out = out.replace(/\s+/g, ' ').trim();

  return out;
}

function latexToSpeech(math: string, lang = 'fr'): string {
  let m = math.trim();
  if (lang === 'en') {
    m = m.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 over $2');
    m = m.replace(/([a-zA-Z0-9])\^2/g, '$1 squared');
    m = m.replace(/([a-zA-Z0-9])\^([0-9a-zA-Z]+)/g, '$1 to the power of $2');
    m = m.replace(/\+/g, ' plus ');
    m = m.replace(/-/g, ' minus ');
    m = m.replace(/=/g, ' equals ');
  } else {
    m = m.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 sur $2');
    m = m.replace(/([a-zA-Z0-9])\^2/g, '$1 au carré');
    m = m.replace(/([a-zA-Z0-9])\^3/g, '$1 au cube');
    m = m.replace(/([a-zA-Z0-9])\^\{?([0-9a-zA-Z]+)\}?/g, '$1 puissance $2');
    m = m.replace(/\+/g, ' plus ');
    m = m.replace(/-/g, ' moins ');
    m = m.replace(/=/g, ' égale ');
  }
  return ' ' + m + ' ';
}
