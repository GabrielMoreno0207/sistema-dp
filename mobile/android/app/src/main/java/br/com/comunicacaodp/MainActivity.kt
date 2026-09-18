package br.com.comunicacaodp

import android.content.Intent
import android.os.Build
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "ComunicacaoDP"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    handleNotificationIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleNotificationIntent(intent)
  }

  /** Aberto por uma notificação: entrega o payload ao JavaScript (e acende a tela nos urgentes) */
  private fun handleNotificationIntent(intent: Intent?) {
    val payload = intent?.getStringExtra(Notifications.EXTRA_PAYLOAD) ?: return
    val urgent = intent.getBooleanExtra(Notifications.EXTRA_URGENT, false)
    intent.removeExtra(Notifications.EXTRA_PAYLOAD)
    intent.removeExtra(Notifications.EXTRA_URGENT)
    if (urgent && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
    DpModule.deliverOpened(payload)
  }
}
