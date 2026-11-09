(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.body.classList.add("is-ready");

  const reveal = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      reveal.unobserve(entry.target);
    }
  }, { threshold: 0.16, rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll("[data-reveal]").forEach(element => reveal.observe(element));

  const tagline = document.querySelector("[data-words]");
  if (tagline) {
    const text = tagline.textContent.trim();
    tagline.textContent = "";
    const words = text.split("");
    for (const character of words) {
      const span = document.createElement("span");
      span.textContent = character;
      tagline.appendChild(span);
    }
    const wordsObserver = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      const spans = [...tagline.querySelectorAll("span")];
      spans.forEach((span, index) => setTimeout(() => span.classList.add("is-lit"), index * 34));
      wordsObserver.disconnect();
    }, { threshold: 0.5 });
    wordsObserver.observe(tagline);
  }

  const orbit = document.querySelector(".orbit");
  if (orbit && !reduceMotion) {
    let frame = 0;
    orbit.addEventListener("pointermove", event => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        const rect = orbit.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        orbit.style.setProperty("--tilt-x", `${(-y * 8).toFixed(2)}deg`);
        orbit.style.setProperty("--tilt-y", `${(x * 10).toFixed(2)}deg`);
        frame = 0;
      });
    });
    orbit.addEventListener("pointerleave", () => {
      orbit.style.setProperty("--tilt-x", "0deg");
      orbit.style.setProperty("--tilt-y", "0deg");
    });
  }

  const copy = document.querySelector("[data-copy]");
  const status = document.querySelector(".copy__status");
  if (copy && status) {
    copy.addEventListener("click", async () => {
      const source = document.querySelector(copy.dataset.copy);
      const text = source?.content?.textContent || source?.textContent || "";
      try {
        await navigator.clipboard.writeText(text.trim());
        status.textContent = "已复制";
      } catch {
        status.textContent = "请手动选择命令";
      }
      window.setTimeout(() => { status.textContent = ""; }, 2200);
    });
  }
})();
