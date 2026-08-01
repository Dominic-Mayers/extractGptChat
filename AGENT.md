# Context for conversation

## Diagnostic and no-diagnostic sources

The `*-diag.js` files are the canonical sources with diagnostics. Plain `*.js` files are generated from them with diagnostics removed. Both bundles must be built after every modification and must remain functionally synchronized.

## Rules

* Do not add comments in the code. I will add them for human beings.
* You can change the flow of the code as needed in a localized manner that respects the  flow that I requested.
* Never change the flow of the code beyond what I request, unless it is localized.
* For example, do not make a function depends on a policy unless I decide that the policy is external to the function, not hardcoded in the function. (You did that in a previous session and that surprised me a lot.)
* Minimize the use of `try` blocks.
* Never add a `try` block solely for diagnostic purposes. Collect and log relevant information during the run, let errors bubble to the end, and use the collected information there when needed.
* You should do every thing possible so that I never met structures or abtsractions (small wrappers, etc.) that seem to implement an architectural need or principle that fits your internal patterns but is not part of what we discussed. Keeps the code straightforward and non opaque.

## Bumping version, building and committing

Aways bump the version, build and commit the change after every modification. 

## The model of chatGPT + browser

The main challenge in designing the extractor lies in the fact that we do not know how ChatGPT works or how it interacts with the browser. To address this challenge, we must base our design on a model of this environment that is not bogged down by a multitude of technical details. This strategy can be understood by analogy with the discovery of scientific laws: the law of universal gravitation is extremely simple compared to the complexity of the technical aspects involved in its application. Similarly, we need to seek a simple model of ChatGPT and its interaction with the browser. The ARCHITECTURE.md file attempts to present such a model. It may need to be fleshed out, but we must be careful not to aim for technical exhaustiveness. That is the crux of the matter: we must distinguish the fundamental model from the technical aspects—which should be handled separately during the model's implementation but can be ignored if they are already covered by existing code.
