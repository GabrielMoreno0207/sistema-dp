package br.com.comunicacaodp

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.lang.ref.WeakReference
import java.security.SecureRandom

/** Implementação do módulo nativo definido em src/specs/NativeDpNative.ts */
class DpModule(private val context: ReactApplicationContext) : NativeDpNativeSpec(context) {

  companion object {
    const val NAME = "DpNative"
    const val PREFS = "dp_prefs"
    const val PREF_AUTOSTART = "autostart"

    @Volatile private var pendingPayload: String? = null
    @Volatile private var instance: WeakReference<DpModule>? = null

    /** Chamado pela MainActivity quando o app é aberto por uma notificação */
    fun deliverOpened(payload: String) {
      pendingPayload = payload
      instance?.get()?.emitOnNotificationOpened(payload)
    }
  }

  init {
    instance = WeakReference(this)
  }

  override fun getName(): String = NAME

  // ---------------------------------------------------------------- serviço e início automático

  override fun startService() {
    DpService.start(context)
  }

  override fun stopService() {
    DpService.stop(context)
  }

  override fun isServiceRunning(promise: Promise) {
    promise.resolve(DpService.running)
  }

  override fun setAutostart(enabled: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(PREF_AUTOSTART, enabled).apply()
  }

  override fun updateServiceStatus(text: String) {
    DpService.updateStatus(context, text)
  }

  // ---------------------------------------------------------------- aparelho

  override fun getDeviceInfo(promise: Promise) {
    val info = Arguments.createMap()
    info.putString("manufacturer", Build.MANUFACTURER ?: "")
    info.putString("model", Build.MODEL ?: "")
    info.putString("androidVersion", Build.VERSION.RELEASE ?: "")
    info.putDouble("sdkInt", Build.VERSION.SDK_INT.toDouble())
    val version =
        try {
          context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0"
        } catch (e: Exception) {
          "0"
        }
    info.putString("appVersion", version)
    promise.resolve(info)
  }

  override fun randomHex(bytes: Double, promise: Promise) {
    val size = bytes.toInt().coerceIn(1, 128)
    val buffer = ByteArray(size)
    SecureRandom().nextBytes(buffer)
    promise.resolve(buffer.joinToString("") { "%02X".format(it) })
  }

  // ---------------------------------------------------------------- permissões e configurações do Android

  override fun areNotificationsEnabled(promise: Promise) {
    promise.resolve(Notifications.canPost(context))
  }

  override fun isIgnoringBatteryOptimizations(promise: Promise) {
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    promise.resolve(power.isIgnoringBatteryOptimizations(context.packageName))
  }

  override fun requestIgnoreBatteryOptimizations() {
    val intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
    if (!tryStart(intent)) tryStart(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
  }

  override fun canUseFullScreenIntent(promise: Promise) {
    promise.resolve(Notifications.canUseFullScreen(context))
  }

  override fun openFullScreenIntentSettings() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      val intent =
          Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}"))
      if (tryStart(intent)) return
    }
    openAppSettings()
  }

  override fun openNotificationSettings() {
    val intent =
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
    if (!tryStart(intent)) openAppSettings()
  }

  override fun openAppSettings() {
    tryStart(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
  }

  /** Telas de "início automático"/"apps protegidos" de cada marca (a primeira que existir) */
  override fun openAutostartSettings(promise: Promise) {
    val candidates =
        listOf(
            ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
            ComponentName("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"),
            ComponentName("com.samsung.android.sm", "com.samsung.android.sm.battery.ui.BatteryActivity"),
            ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
            ComponentName("com.oplus.safecenter", "com.oplus.safecenter.permission.startup.StartupAppListActivity"),
            ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
            ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
            ComponentName("com.asus.mobilemanager", "com.asus.mobilemanager.entry.FunctionActivity"),
        )
    for (component in candidates) {
      if (tryStart(Intent().setComponent(component))) {
        promise.resolve(true)
        return
      }
    }
    openAppSettings()
    promise.resolve(false)
  }

  // ---------------------------------------------------------------- notificações

  override fun showNotification(
      id: Double,
      channel: String,
      title: String,
      body: String,
      fullScreen: Boolean,
      payload: String,
      promise: Promise
  ) {
    promise.resolve(Notifications.show(context, id.toInt(), channel, title, body, fullScreen, payload))
  }

  override fun cancelNotification(id: Double) {
    NotificationManagerCompat.from(context).cancel(id.toInt())
  }

  override fun playAlertSound() {
    try {
      RingtoneManager.getRingtone(context, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))?.play()
    } catch (_: Exception) {}
  }

  override fun consumeLaunchPayload(promise: Promise) {
    val payload = pendingPayload ?: ""
    pendingPayload = null
    promise.resolve(payload)
  }

  private fun tryStart(intent: Intent): Boolean =
      try {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
      } catch (_: Exception) {
        false
      }
}
