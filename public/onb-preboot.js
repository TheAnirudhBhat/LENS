/* Pre-hydration cover for the onboarding overlay.
   With ?onboarding=1, paint a white cover before the dashboard paints so it
   never flashes behind the (client-only, portal-rendered) onboarding overlay.
   Loaded as a render-blocking <script src> from app/layout.tsx so it runs during
   HTML parse, before the dashboard markup. Onboarding.tsx removes #onb-preboot
   once the overlay is up. */
(function () {
  try {
    if (new URLSearchParams(location.search).get("onboarding") === "1") {
      var d = document.createElement("div");
      d.id = "onb-preboot";
      d.setAttribute(
        "style",
        "position:fixed;inset:0;background:#fff;z-index:55"
      );
      (document.body || document.documentElement).appendChild(d);
    }
  } catch (e) {}
})();
