---
title: Google Sheets Data Demo
---

## Podaci iz Google Sheets

```js
import { loadSheetAsJSON } from "./data/google_data.js";
const data = await loadSheetAsJSON();
```
${data.length}  
${data}
