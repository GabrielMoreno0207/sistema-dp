package br.com.comunicacaodp

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import org.json.JSONObject
import java.io.File
import java.lang.ref.WeakReference
import java.security.SecureRandom
import java.util.concurrent.Executors

/** Implementação do módulo nativo definido em src/specs/NativeDpNative.ts */
class DpModule(private val context: ReactApplicationContext) : NativeDpNativeSpec(context) {

  companion object {
    const val NAME = "DpNative"
    const val PREFS = "dp_prefs"
    const val PREF_AUTOSTART = "autostart"
    private const val REQUEST_PICK = 4101
    private const val REQUEST_CAMERA = 4102

    @Volatile private var pendingPayload: String? = null
    @Volatile private var instance: WeakReference<DpModule>? = null

    /** Chamado pela MainActivity quando o app é aberto por uma notificação */
    fun deliverOpened(payload: String) {
      pendingPayload = payload
      instance?.get()?.emitOnNotificationOpened(payload)
    }
  }

  private val io = Executors.newCachedThreadPool()
  /** Seletor de arquivo ou câmera aberto, esperando a resposta da outra tela */
  private var pickPromise: Promise? = null
  private var cameraFile: File? = null

  private val activityListener =
      object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
          if (requestCode != REQUEST_PICK && requestCode != REQUEST_CAMERA) return
          val promise = pickPromise ?: return
          pickPromise = null
          if (resultCode != Activity.RESULT_OK) {
            promise.resolve("")
            return
          }
          try {
            if (requestCode == REQUEST_PICK) {
              val uri = data?.data
              promise.resolve(if (uri == null) "" else DpFiles.describe(context, uri).toString())
            } else {
              val file = cameraFile
              cameraFile = null
              promise.resolve(
                  if (file == null || !file.exists() || file.length() == 0L) ""
                  else DpFiles.describe(context, Uri.fromFile(file)).put("mimeType", "image/jpeg").toString())
            }
          } catch (e: Exception) {
            promise.reject("ARQUIVO", e.message, e)
          }
        }
      }

  init {
    instance = WeakReference(this)
    context.addActivityEventListener(activityListener)
  }

  /** Roda fora da thread principal e responde a promessa */
  private fun background(promise: Promise, code: String, work: () -> Any?) {
    io.execute {
      try {
        promise.resolve(work())
      } catch (e: Exception) {
        promise.reject(code, e.message ?: "Falha inesperada", e)
      }
    }
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

  // ---------------------------------------------------------------- arquivos

  override fun pickFile(mimeTypes: ReadableArray, promise: Promise) {
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("ARQUIVO", "O aplicativo não está aberto")
      return
    }
    pickPromise?.resolve("")
    pickPromise = promise
    val tipos = (0 until mimeTypes.size()).mapNotNull { mimeTypes.getString(it) }.filter { it.isNotBlank() }
    val intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(if (tipos.size == 1) tipos[0] else "*/*")
    if (tipos.size > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, tipos.toTypedArray())
    try {
      activity.startActivityForResult(intent, REQUEST_PICK)
    } catch (e: Exception) {
      pickPromise = null
      promise.reject("ARQUIVO", "Nenhum seletor de arquivos neste celular", e)
    }
  }

  override fun takePhoto(promise: Promise) {
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("ARQUIVO", "O aplicativo não está aberto")
      return
    }
    pickPromise?.resolve("")
    pickPromise = promise
    try {
      val (file, uri) = DpFiles.newCameraFile(context)
      cameraFile = file
      val intent =
          Intent(MediaStore.ACTION_IMAGE_CAPTURE)
              .putExtra(MediaStore.EXTRA_OUTPUT, uri)
              .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      activity.startActivityForResult(intent, REQUEST_CAMERA)
    } catch (e: Exception) {
      pickPromise = null
      cameraFile = null
      promise.reject("ARQUIVO", "Não foi possível abrir a câmera", e)
    }
  }

  override fun uploadFile(url: String, token: String, uri: String, mimeType: String, headersJson: String, promise: Promise) =
      background(promise, "ENVIO") {
        val headers = if (headersJson.isBlank()) JSONObject() else JSONObject(headersJson)
        DpFiles.upload(context, url, token, Uri.parse(uri), mimeType, headers).toString()
      }

  override fun downloadFile(url: String, token: String, folder: String, fileName: String, promise: Promise) =
      background(promise, "DOWNLOAD") { DpFiles.download(context, url, token, folder, fileName).absolutePath }

  override fun openFile(path: String, mimeType: String, promise: Promise) {
    val file = File(path)
    if (!file.exists()) {
      promise.resolve(false)
      return
    }
    promise.resolve(tryStart(Intent.createChooser(DpFiles.viewIntent(context, file, mimeType), "Abrir com")))
  }

  override fun sha256File(path: String, promise: Promise) = background(promise, "ARQUIVO") { DpFiles.sha256(File(path)) }

  override fun prepareImage(uri: String, maxSide: Double, promise: Promise) =
      background(promise, "FOTO") { DpFiles.prepareImage(context, Uri.parse(uri), maxSide.toInt()).toString() }

  override fun cropImage(
      uri: String,
      x: Double,
      y: Double,
      width: Double,
      height: Double,
      outSize: Double,
      promise: Promise
  ) =
      background(promise, "FOTO") {
        val file = DpFiles.crop(context, Uri.parse(uri), x.toInt(), y.toInt(), width.toInt(), height.toInt(), outSize.toInt())
        Uri.fromFile(file).toString()
      }

  override fun copyText(text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
    clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Comunica Trinys", text))
  }

  // ---------------------------------------------------------------- atualização

  override fun canInstallPackages(promise: Promise) {
    promise.resolve(Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls())
  }

  override fun openInstallPermissionSettings() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
      if (tryStart(intent)) return
    }
    openAppSettings()
  }

  override fun installApk(path: String, promise: Promise) {
    val file = File(path)
    if (!file.exists()) {
      promise.resolve(false)
      return
    }
    promise.resolve(tryStart(DpFiles.viewIntent(context, file, "application/vnd.android.package-archive")))
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
