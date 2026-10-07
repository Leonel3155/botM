import { formatStatNumber } from "./format";

/**
 * Valor para StatCard que no se sale de la tarjeta: los números muy largos se abrevian
 * ("1.2 M") con el exacto al pasar el cursor y para lectores de pantalla.
 */
export function StatNumber({ value }: { value: number | null | undefined }) {
  const { text, full } = formatStatNumber(value);
  if (!full) return <span className="break-all">{text}</span>;
  return (
    <span className="break-all" title={full}>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{full}</span>
    </span>
  );
}
