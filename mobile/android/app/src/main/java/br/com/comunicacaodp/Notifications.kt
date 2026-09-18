package br.com.comunicacaodp

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Canais e notificações do app */
object Notifications {
  const val CHANNEL_SERVICE = "dp_servico"
  const val CHANNEL_MESSAGES = "dp_comunicados"
  const val CHANNEL_URGENT = "dp_urgentes"
  const val CHANNEL_CHAT = "dp_chat"
  const val EXTRA_PAYLOAD = "dp_payload"
  const val EXTRA_URGENT = "dp_urgent"

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    val audio =
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

    fun alertChannel(id: String, name: String, description: String, pattern: LongArray) =
        NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH).apply {
          this.description = description
          enableVibration(true)
          vibrationPattern = pattern
          enableLights(true)
          lightColor = Color.BLUE
          setSound(sound, audio)
          lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
        }

    manager.createNotificationChannels(
        listOf(
            NotificationChannel(CHANNEL_SERVICE, "Conexão com o servidor", NotificationManager.IMPORTANCE_MIN).apply {
              description = "Notificação fixa que mantém o app recebendo os avisos"
              setShowBadge(false)
            },
            alertChannel(CHANNEL_MESSAGES, "Comunicados", "Comunicados, avisos e informativos do DP", longArrayOf(0, 300, 200, 300)),
            alertChannel(CHANNEL_URGENT, "Urgentes", "Comunicados urgentes do DP (aparecem em tela cheia)", longArrayOf(0, 600, 250, 600, 250, 600)),
            alertChannel(CHANNEL_CHAT, "Mensagens do DP", "Mensagens do chat com as pessoas do DP", longArrayOf(0, 250)),
        ))
  }

  /** Abre o app; o payload volta para o JavaScript (DpModule.consumeLaunchPayload) */
  fun openAppIntent(context: Context, requestCode: Int, payload: String?, urgent: Boolean): PendingIntent {
    val intent =
        Intent(context, MainActivity::class.java).apply {
          flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
          if (payload != null) putExtra(EXTRA_PAYLOAD, payload)
          if (urgent) putExtra(EXTRA_URGENT, true)
        }
    return PendingIntent.getActivity(
        context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  fun canPost(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      return false
    }
    return NotificationManagerCompat.from(context).areNotificationsEnabled()
  }

  fun canUseFullScreen(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return manager.canUseFullScreenIntent()
  }

  /** Mostra um aviso. Retorna false se o usuário não permitiu notificações. */
  fun show(context: Context, id: Int, channel: String, title: String, body: String, fullScreen: Boolean, payload: String): Boolean {
    if (!canPost(context)) return false
    ensureChannels(context)
    val channelId =
        when (channel) {
          "urgentes" -> CHANNEL_URGENT
          "chat" -> CHANNEL_CHAT
          else -> CHANNEL_MESSAGES
        }
    val urgent = channelId == CHANNEL_URGENT
    val chat = channelId == CHANNEL_CHAT
    val builder =
        NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_dp)
            .setColor(if (urgent) Color.rgb(220, 38, 38) else Color.rgb(29, 78, 216))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            // Comunicado fica fixo: não sai com um deslize nem no "limpar tudo". Some quando o
            // funcionário toca nele (autoCancel) ou quando o app marca a mensagem como lida.
            // Mensagem de chat continua normal — conversa não é para ficar presa na barra.
            .setOngoing(!chat)
            .setAutoCancel(true)
            .setPriority(if (urgent) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)
            .setCategory(if (channelId == CHANNEL_CHAT) NotificationCompat.CATEGORY_MESSAGE else NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openAppIntent(context, id, payload, urgent))
    if (fullScreen && canUseFullScreen(context)) {
      builder.setFullScreenIntent(openAppIntent(context, id + 1_000_000, payload, true), true)
    }
    NotificationManagerCompat.from(context).notify(id, builder.build())
    return true
  }
}
