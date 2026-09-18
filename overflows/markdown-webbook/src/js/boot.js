
            /* Apply persisted theme before first paint to avoid a flash.
               Values: "light" | "dark" | "auto" (resolved against the OS). */
            (function () {
                try {
                    var t =
                        localStorage.getItem("mdwb:theme") ||
                        localStorage.getItem("md-v-t");
                    if (t && t.charAt(0) === '"') {
                        try {
                            t = JSON.parse(t);
                        } catch (e) {}
                    }
                    if (t !== "light" && t !== "dark") {
                        t =
                            window.matchMedia &&
                            window.matchMedia("(prefers-color-scheme: dark)")
                                .matches
                                ? "dark"
                                : "light";
                    }
                    document.documentElement.setAttribute("data-theme", t);
                    /* Reading preferences apply before first paint too —
                       no flash of default typography or header accent. */
                    var s = localStorage.getItem("mdwb:settings");
                    if (s) {
                        try {
                            s = JSON.parse(s);
                            var okVals = {
                                size: ["s", "m", "l"],
                                lh: ["s", "m", "l"],
                                width: ["s", "m", "l"],
                                family: ["sans", "serif"],
                                accent: [
                                    "none", "blue", "orange", "yellow", "green",
                                ],
                            };
                            for (var k in okVals) {
                                if (s[k] && okVals[k].indexOf(s[k]) !== -1)
                                    document.documentElement.setAttribute(
                                        "data-" + k,
                                        s[k],
                                    );
                            }
                        } catch (e) {}
                    }
                } catch (e) {}
            })();
        