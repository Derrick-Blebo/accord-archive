package com.accordarchives.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.accordarchives.app.ui.theme.AccordTheme

private const val HOME_URL = "https://www.accordarchives.com/"
private val IN_APP_HOSTS = setOf(
  "accordarchives.com",
  "www.accordarchives.com",
  "mzblgajftvyyosyrawcx.supabase.co",
  "accounts.google.com",
  "checkout.paystack.com",
  "standard.paystack.co",
)

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    val startUrl = intent?.dataString?.takeIf { it.startsWith("https://") } ?: HOME_URL

    setContent {
      AccordTheme {
        Surface(
          modifier = Modifier.fillMaxSize(),
          color = Color(0xFFF8FAFC)
        ) {
          AccordWebViewScreen(startUrl = startUrl)
        }
      }
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun AccordWebViewScreen(startUrl: String) {
  var webViewRef by remember { mutableStateOf<WebView?>(null) }
  var progress by remember { mutableIntStateOf(0) }
  var isLoading by remember { mutableStateOf(true) }
  var hasError by remember { mutableStateOf(false) }
  var fileUploadCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }

  val fileChooserLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.StartActivityForResult()
  ) { result ->
    val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
    fileUploadCallback?.onReceiveValue(uris)
    fileUploadCallback = null
  }

  BackHandler(enabled = webViewRef?.canGoBack() == true) {
    webViewRef?.goBack()
  }

  Box(
    modifier = Modifier
      .fillMaxSize()
      .systemBarsPadding()
  ) {
    AndroidView(
      modifier = Modifier.fillMaxSize(),
      factory = { context ->
        WebView(context).apply {
          val webView = this
          webViewRef = webView

          CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
          }

          settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = false
            displayZoomControls = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
          }

          webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
              hasError = false
              isLoading = true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
              isLoading = false
            }

            override fun onReceivedError(
              view: WebView?,
              request: WebResourceRequest?,
              error: WebResourceError?
            ) {
              if (request?.isForMainFrame == true) {
                hasError = true
                isLoading = false
              }
            }

            override fun shouldOverrideUrlLoading(
              view: WebView?,
              request: WebResourceRequest?
            ): Boolean {
              val uri = request?.url ?: return false
              val scheme = uri.scheme?.lowercase()
              if (scheme != "http" && scheme != "https") {
                runCatching {
                  context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                }
                return true
              }

              val host = uri.host?.lowercase().orEmpty()
              val keepInApp = IN_APP_HOSTS.any { host == it || host.endsWith(".$it") }
              if (!keepInApp) {
                runCatching {
                  context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                }
                return true
              }
              return false
            }
          }

          webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
              progress = newProgress
              if (newProgress >= 100) {
                isLoading = false
              }
            }

            override fun onShowFileChooser(
              webView: WebView?,
              filePathCallback: ValueCallback<Array<Uri>>?,
              fileChooserParams: FileChooserParams?
            ): Boolean {
              fileUploadCallback?.onReceiveValue(null)
              fileUploadCallback = filePathCallback
              val intent = runCatching { fileChooserParams?.createIntent() }.getOrNull()
                ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                  addCategory(Intent.CATEGORY_OPENABLE)
                  type = "*/*"
                }
              return try {
                fileChooserLauncher.launch(intent)
                true
              } catch (_: Exception) {
                fileUploadCallback = null
                false
              }
            }
          }

          loadUrl(startUrl)
        }
      }
    )

    if (isLoading && progress in 1..99) {
      LinearProgressIndicator(
        progress = { progress / 100f },
        modifier = Modifier
          .fillMaxWidth()
          .height(3.dp)
          .align(Alignment.TopCenter),
        color = Color(0xFF0077FF),
        trackColor = Color(0xFFE6F0FF),
      )
    }

    if (hasError) {
      Surface(
        modifier = Modifier.fillMaxSize(),
        color = Color(0xFFF8FAFC)
      ) {
        Column(
          modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
          verticalArrangement = Arrangement.Center,
          horizontalAlignment = Alignment.CenterHorizontally
        ) {
          Text(
            text = "Unable to connect to Accord",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
            color = Color(0xFF0F172A),
            textAlign = TextAlign.Center
          )
          Spacer(modifier = Modifier.height(8.dp))
          Text(
            text = "Check your internet connection and try again.",
            style = MaterialTheme.typography.bodyMedium,
            color = Color(0xFF64748B),
            textAlign = TextAlign.Center
          )
          Spacer(modifier = Modifier.height(20.dp))
          Button(
            onClick = {
              hasError = false
              isLoading = true
              webViewRef?.reload()
            },
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0077FF))
          ) {
            Text("Retry")
          }
        }
      }
    }
  }
}
