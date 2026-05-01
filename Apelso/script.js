const strategies = {
  conservative: {
    title: "Konzervatív",
    text: "Mérsékelt kockázatvállalás mellett, legalább 3 éves időtávra kialakított stratégiai összetétel.",
    values: {
      cash: 5,
      shortBonds: 20,
      longBonds: 55,
      developedEquity: 10,
      emergingEquity: 5,
      alternatives: 5,
    },
  },
  balanced: {
    title: "Kiegyensúlyozott",
    text: "Közepes kockázatvállalással, legalább 5 éves időtávon a stabilitás és a növekedési lehetőség egyensúlyára épít.",
    values: {
      cash: 5,
      shortBonds: 5,
      longBonds: 45,
      developedEquity: 25,
      emergingEquity: 10,
      alternatives: 10,
    },
  },
  growth: {
    title: "Növekedési",
    text: "Magasabb kockázatvállalás mellett, legalább 7 éves időtávra, jelentősebb reálhozam-lehetőségre tervezve.",
    values: {
      cash: 5,
      shortBonds: 0,
      longBonds: 30,
      developedEquity: 35,
      emergingEquity: 10,
      alternatives: 20,
    },
  },
};

const initIcons = () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }
};

const revealElements = () => {
  const targets = document.querySelectorAll("[data-reveal], .reveal-card");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16 }
  );

  targets.forEach((target) => observer.observe(target));
};

const bindParallax = () => {
  const image = document.querySelector(".hero-image");
  if (!image || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  let rafId = 0;
  const update = () => {
    const offset = Math.min(window.scrollY, 620);
    image.style.setProperty("--parallax-y", `${offset * 0.035}px`);
    rafId = 0;
  };

  window.addEventListener(
    "scroll",
    () => {
      if (!rafId) {
        rafId = window.requestAnimationFrame(update);
      }
    },
    { passive: true }
  );
};

const bindMobileMenu = () => {
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".main-nav");
  const compactToggle = document.querySelector(".compact-menu-toggle");
  const compactMenu = document.querySelector(".compact-menu");
  if (!toggle || !nav) {
    return;
  }

  toggle.addEventListener("click", () => {
    const isOpen = document.body.classList.toggle("nav-open");
    toggle.setAttribute("aria-label", isOpen ? "Navigáció bezárása" : "Navigáció megnyitása");
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      document.body.classList.remove("nav-open");
      toggle.setAttribute("aria-label", "Navigáció megnyitása");
    });
  });

  compactToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    const isOpen = compactMenu.classList.toggle("is-open");
    compactToggle.setAttribute(
      "aria-label",
      isOpen ? "További menü bezárása" : "További menü megnyitása"
    );
  });
};

const bindStrategyTabs = () => {
  const tabs = document.querySelectorAll(".strategy-tab");
  const title = document.querySelector("#strategy-title");
  const text = document.querySelector("#strategy-text");
  const rows = document.querySelectorAll(".allocation-row");

  if (!tabs.length || !title || !text || !rows.length) {
    return;
  }

  const setStrategy = (key) => {
    const strategy = strategies[key];
    if (!strategy) {
      return;
    }

    tabs.forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.strategy === key);
    });

    rows.forEach((row) => {
      const valueNode = row.querySelector("strong");
      const bar = row.querySelector("b");
      const value = strategy.values[valueNode.dataset.key];
      row.classList.remove("is-filling");
      bar.style.width = "0%";

      window.requestAnimationFrame(() => {
        title.textContent = strategy.title;
        text.textContent = strategy.text;
        valueNode.textContent = `${value}%`;
        row.classList.add("is-filling");
        bar.style.width = `${value}%`;
      });
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setStrategy(tab.dataset.strategy));
  });
};

const offsetHashNavigation = () => {
  const scrollWithHeaderOffset = () => {
    if (!window.location.hash) {
      return;
    }

    const target = document.querySelector(window.location.hash);
    if (!target) {
      return;
    }

    const headerHeight = document.querySelector(".site-header")?.offsetHeight ?? 0;
    const top = target.getBoundingClientRect().top + window.scrollY - headerHeight - 20;
    window.scrollTo({ top, behavior: "auto" });
  };

  window.addEventListener("hashchange", () => window.requestAnimationFrame(scrollWithHeaderOffset));
  window.requestAnimationFrame(scrollWithHeaderOffset);
  window.setTimeout(scrollWithHeaderOffset, 80);
};

document.addEventListener("DOMContentLoaded", () => {
  initIcons();
  revealElements();
  bindParallax();
  bindMobileMenu();
  bindStrategyTabs();
  offsetHashNavigation();
});
