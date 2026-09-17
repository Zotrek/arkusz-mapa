/** Oficjalne nazwy 16 województw (kolejność alfabetyczna pl). */
export const POLISH_VOIVODESHIPS = [
  'Dolnośląskie',
  'Kujawsko-Pomorskie',
  'Lubelskie',
  'Lubuskie',
  'Łódzkie',
  'Małopolskie',
  'Mazowieckie',
  'Opolskie',
  'Podkarpackie',
  'Podlaskie',
  'Pomorskie',
  'Śląskie',
  'Świętokrzyskie',
  'Warmińsko-Mazurskie',
  'Wielkopolskie',
  'Zachodniopomorskie',
] as const;

export type PolishVoivodeship = (typeof POLISH_VOIVODESHIPS)[number];

/** Czy wartość jest jedną z 16 oficjalnych nazw. */
export function isPolishVoivodeship(value: string | undefined): value is PolishVoivodeship {
  const t = String(value ?? '').trim();
  return (POLISH_VOIVODESHIPS as readonly string[]).includes(t);
}
