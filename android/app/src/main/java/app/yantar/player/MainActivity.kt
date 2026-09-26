package app.yantar.player

import android.os.Bundle
import app.yantar.player.core.MusicCorePlugin
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Собственный плагин регистрируется до super.onCreate, иначе мост его не увидит
        registerPlugin(MusicCorePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
