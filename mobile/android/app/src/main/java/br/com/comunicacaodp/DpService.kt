package br.com.comunicacaodp

import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/**
 * Serviço em primeiro plano que mantém o app conectado ao servidor mesmo com a tela fechada.
 *
 * Roda a tarefa JavaScript "DpConnectionTask" (index.js) sem prazo para terminar: enquanto ela
 * roda, o React Native mantém os timers do JS ativos (reconexão, ping do Socket.IO).
 * Não segura o processador acordado (sem wake lock): pacotes que chegam pela rede acordam o
 * celular, como acontece com os apps de mensagem.
 */
class DpService : Service() {

  companion object {
    private const val TAG = "DpService"
    const val TASK_NAME = "DpConnectionTask"
    const val SERVICE_NOTIFICATION_ID = 1

    @Volatile var running = false
      private set

    @Volatile private var statusText = "Conectando ao servidor..."

    fun start(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, DpService::class.java))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, DpService::class.java))
    }

    fun updateStatus(context: Context, text: String) {
      statusText = text
      if (!running) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(SERVICE_NOTIFICATION_ID, buildNotification(context))
    }

    private fun buildNotification(context: Context): Notification {
      Notifications.ensureChannels(context)
      return NotificationCompat.Builder(context, Notifications.CHANNEL_SERVICE)
          .setSmallIcon(R.drawable.ic_stat_dp)
          .setContentTitle("Comunicação DP")
          .setContentText(statusText)
          .setOngoing(true)
          .setShowWhen(false)
          .setPriority(NotificationCompat.PRIORITY_MIN)
          .setCategory(NotificationCompat.CATEGORY_SERVICE)
          .setContentIntent(Notifications.openAppIntent(context, SERVICE_NOTIFICATION_ID, null, false))
          .build()
    }
  }

  private var taskId: Int? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = buildNotification(this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(SERVICE_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(SERVICE_NOTIFICATION_ID, notification)
    }
    running = true
    startJsTask()
    return START_STICKY // se o Android encerrar o processo, ele recria o serviço
  }

  private fun startJsTask() {
    val host =
        (application as ReactApplication).reactHost
            ?: run {
              Log.e(TAG, "React Native indisponível: tarefa de conexão não iniciada")
              return
            }
    val current = host.currentReactContext
    if (current != null) {
      launchTask(current)
      return
    }
    host.addReactInstanceEventListener(
        object : ReactInstanceEventListener {
          override fun onReactContextInitialized(context: ReactContext) {
            host.removeReactInstanceEventListener(this)
            launchTask(context)
          }
        })
    host.start()
  }

  private fun launchTask(context: ReactContext) {
    UiThreadUtil.runOnUiThread {
      try {
        val headless = HeadlessJsTaskContext.getInstance(context)
        val existing = taskId
        if (existing != null && headless.isTaskRunning(existing)) return@runOnUiThread
        // timeout 0 = sem prazo; allowedInForeground = também roda com o app aberto
        taskId = headless.startTask(HeadlessJsTaskConfig(TASK_NAME, Arguments.createMap(), 0, true))
      } catch (e: Exception) {
        Log.e(TAG, "Não foi possível iniciar a tarefa de conexão", e)
      }
    }
  }

  override fun onDestroy() {
    running = false
    val id = taskId
    val context = (application as ReactApplication).reactHost?.currentReactContext
    if (id != null && context != null) {
      UiThreadUtil.runOnUiThread {
        val headless = HeadlessJsTaskContext.getInstance(context)
        if (headless.isTaskRunning(id)) headless.finishTask(id)
      }
    }
    taskId = null
    super.onDestroy()
  }
}
