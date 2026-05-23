// Theme switcher function
// Apply saved theme on page load
document.addEventListener("DOMContentLoaded", () => {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.body.className = savedTheme; // Apply class to body
});

// Function to set theme
function setTheme(theme) {
  document.body.className = theme;
  localStorage.setItem("theme", theme);
}

// FAQ toggle function
function toggleFAQ(element) {
  const item = element.parentElement;

  // Close other open FAQs
  document.querySelectorAll(".faq-item").forEach((faq) => {
    if (faq !== item) faq.classList.remove("active");
  });

  // Toggle current one
  item.classList.toggle("active");
}

// Scroll to section function
function scrollToSection(sectionId) {
  if (sectionId === "home") {
    // Reload the page to go back to initial state
    window.location.href = "home.html";
    return;
  }

  if (sectionId === "about") {
    // Navigate to about page
    window.location.href = "about.html";
    return;
  }

  if (sectionId === "contact") {
    // Navigate to contact page
    window.location.href = "contact.html";
    return;
  }

  if (sectionId === "pricing") {
    // Scroll to pricing/comparison section
    const pricingSection = document.querySelector(".pricing-container");
    if (pricingSection) {
      pricingSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return;
  }

  if (sectionId === "faqs") {
    // Scroll to FAQ section
    const faqSection = document.querySelector(".faq-container");
    if (faqSection) {
      faqSection.parentElement.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
    return;
  }

  // For courses and other sections with IDs
  const section = document.getElementById(sectionId);
  if (section) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// Smooth scroll for anchor links in footer and other links
document.addEventListener("DOMContentLoaded", function () {
  // Handle all anchor links that point to sections on the same page
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      e.preventDefault();
      const targetId = this.getAttribute("href").substring(1);

      if (targetId === "courses") {
        scrollToSection("courses");
      } else {
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });
  });

  // Handle "Get Started" buttons to scroll to pricing section
  document.querySelectorAll('a[href=""]').forEach((button) => {
    button.addEventListener("click", function (e) {
      e.preventDefault();
      const pricingSection = document.querySelector(".pricing-container");
      if (pricingSection) {
        pricingSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  // Handle "Get Started" buttons to scroll to pricing section
  document.querySelectorAll('a[href="subscribe.html"]').forEach((button) => {
    button.addEventListener("click", function (e) {
      e.preventDefault();
      const pricingSection = document.querySelector(".pricing-container");
      if (pricingSection) {
        pricingSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  // Handle footer links for home
  document
    .querySelectorAll('a[href="index.html"], a[href="home.html"]')
    .forEach((link) => {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

  // Handle footer links for FAQ
  document.querySelectorAll('a[href="faq.html"]').forEach((link) => {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      const faqSection = document.querySelector(".faq-container");
      if (faqSection) {
        faqSection.parentElement.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    });
  });
});

