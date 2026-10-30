export default function Brand({ compact = false, inverse = false }) {
  return (
    <span className={`brand${compact ? " brand--compact" : ""}${inverse ? " brand--inverse" : ""}`} aria-label="Hostlet">
      <span className="brand__mark" aria-hidden="true">
        <span>H</span>
      </span>
      <span className="brand__name">Hostlet</span>
    </span>
  );
}

