// Load the local UI font before first render so initial canvas measurements and
// form geometry use the same metrics. A failed local request keeps the system fallback usable.
export async function loadUiFont(fonts: Pick<FontFaceSet, 'load'> = document.fonts): Promise<boolean> {
  try { return (await fonts.load('400 14px "Inter"')).length > 0; }
  catch { return false; }
}

// Canvas text does not inherit CSS. uPlot axes must explicitly use the UI tokens.
export function canvasUiFont(weight: 'regular' | 'medium' = 'regular'): string {
  const style = getComputedStyle(document.documentElement);
  return `${style.getPropertyValue(`--font-weight-${weight}`).trim()} ${style.getPropertyValue('--font-size-xs').trim()} ${style.getPropertyValue('--font-ui').trim()}`;
}
