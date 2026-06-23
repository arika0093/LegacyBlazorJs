# Troubleshooting

If you're reading this page, your app probably isn't working properly.
Since Blazor Server is a complex framework, there could be several possible causes.

## Check Console Output

First and foremost, check the console output in DevTools. Check the following points:

* Whether SignalR connection is established
  * Whether there is an output like `WebSocket connected to ws://(host):(port)/_blazor?id=...`
  * If this appears, at least JS interpretation/execution and SignalR connection establishment are working normally.
* Whether there are any dynamic import errors
  * With older browsers, even if Blazor Server works, various libraries might fail with dynamic imports.
  * In this case, there should be a corresponding message in the console.

### Embed DevTools

If you have no simple way to check on your browser device, you can embed [eruda](https://eruda.liriliri.io/docs/) to display a simple DevTools.
It's recommended to [download](https://cdn.jsdelivr.net/npm/eruda) from the CDN and place it in `wwwroot` to reference it.

```html
<body>
    <Routes @rendermode="InteractiveServer" />
    <!-- Place before other scripts -->
    <script src="@Assets["eruda.js"]"></script>
    <script>eruda.init();</script>
    <script src="@Assets["blazor.server.ie11.js"]"></script>
</body>
```

> [!NOTE]
> It works on IE11, but it doesn't work on very old Chrome versions (specifically, versions where [`Map` is not available](https://caniuse.com/mdn-javascript_builtins_map)).
