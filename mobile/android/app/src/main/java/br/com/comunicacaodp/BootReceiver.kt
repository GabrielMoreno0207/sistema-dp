package br.com.comunicacaodp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Celular ligado (ou app atualizado): inicia o serviço de conexão, se o início automático
 * estiver ativo (o app liga depois que o servidor é configurado).
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val prefs = context.getSharedPreferences(DpModule.PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(DpModule.PREF_AUTOSTART, false)) return
    try {
      DpService.start(context)
      Log.i("DpBoot", "Serviço iniciado (${intent.action})")
    } catch (e: Exception) {
      Log.w("DpBoot", "Não foi possível iniciar o serviço (${intent.action})", e)
    }
  }
}
