export default function PageTypeIcon({ type }) {
  return (
    <span className={`page-type page-type--${type}`} aria-hidden="true">
      <span className="page-type__fold" />
      <span className="page-type__label">{type === "zip" ? "ZIP" : "HTML"}</span>
    </span>
  );
}

