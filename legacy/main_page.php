<?php require_once("commons.php"); ?>
<?php
kick_out_intruders(False);

// Poster un message
if(isset($_POST['message'])){
	$login = get_user_name();
	$text = addslashes($_POST['message']);
	$date = date("Y-m-d H:i:s", time());
	$q = "INSERT INTO ".get_table_messages()."(login,text,date) VALUES('$login','$text','$date')";
	mysql_query($q) or die(mysql_error());
	$id_msg = mysql_insert_id();
	
	if(isset($_FILES['photo'])){
		if ($_FILES['photo']['error'] == 0){
			$extension_upload = strtolower(  substr(  strrchr($_FILES['photo']['name'], '.')  ,1)  );
			$nom = "images/{$id_msg}.{$extension_upload}";
			$resultat = move_uploaded_file($_FILES['photo']['tmp_name'],$nom);
		}
	}
	header("Location:main_page.php#messages");
}

// Supprimer un message
if(isset($_POST['delete_msg'])){
	$id_message = $_POST['delete_msg'];
	$q= "DELETE FROM ".get_table_messages()." WHERE id_message=$id_message";
	mysql_query($q) or die(mysql_error());
	header("Location:main_page.php#messages");
}

if(isset($_POST['like_msg'])){
	$id_message = $_POST['like_msg'];
	$q= "UPDATE ".get_table_messages()." SET `likes`=`likes`+1 WHERE id_message=$id_message";
	mysql_query($q) or die(mysql_error());
	header("Location:main_page.php#messages");
}

function get_photos(){
  $imgs = array();
  $iterator = new DirectoryIterator("images/");
  foreach ($iterator as $fileinfo) {
    if ($fileinfo->isFile()) {
	  $name = $fileinfo->getFilename();
      $imgs[intval($name)] = "images/".$name;
    }
  }
  return $imgs;
}

?>

<?php print_html_header("Pronocave 2024", True); ?>

<h1>Salut <?php echo get_user_name(); ?> !</h1>
		
<div class=" col-md-6 col-md-offset-3 col-sm-8 col-sm-offset-2 text-left margin_down">
<table  class="table table-striped table-hover table-condensed margin_down">
<thead>
<tr><th width= '10'>#</th><th>Nom</th><th>Score</th><th>Bonus</th></tr>
</thead>
<tbody>
<?php   // Tableau users  
  $q = "SELECT id_user,login, score, bonus FROM ".get_table_users()." ORDER BY score DESC, bonus DESC, login ASC";
  $r = mysql_query($q) or die(mysql_error());
  $cpt_users = 1;
  $score_even = 0;
  $score_prev = 1000;
  $phase = get_phase();
  while($user = mysql_fetch_array($r)){
    $id_user=$user['id_user'];
	$score = $user['score'];
	$login = $user['login'];
	$bonus = $user['bonus'];
	if($score==$score_prev)
		$score_even++;
	else
		$score_even=0;
	$cpt_af = $cpt_users - $score_even;
	$cpt_users++;
	$score_prev=$score;
	$class="";
	if($login==get_user_name()){
		$class = " class=\"info\"";
	}
	echo "<tr".$class."><td width= '10'>".$cpt_af."</td><td>";
	if($phase==$PHASE_PRONO)
		echo $login;
	elseif($phase==$PHASE_GROUP)
		echo "<a href='paris.php?log_as=".$id_user."'>".$login."</a>";
	elseif($phase==$PHASE_FINAL)
        echo "<a href='paris_finales.php?log_as=".$id_user."'>".$login."</a>";
	echo "</td><td>".$score."</td><td>".$bonus."</td></tr>";
  }
?>
</tbody>
</table>

<?php if($phase>$PHASE_PRONO) { ?>

<div id="container" style="min-width: 310px; height: 400px; margin: 0 auto">

<script src="http://code.highcharts.com/highcharts.js"></script>

<script type="text/javascript">
$(document).ready(function() {

	// Test de highcharts
	$(function () {

		$('#container').highcharts({
			title:{	text:''	},
		    yAxis: {
		        title: { text: '' },
				labels:	{  enabled: false },
				tickInterval: 1
		    },
			xAxis: {
				labels:	{  enabled: false }
			},
		    tooltip: {
		        formatter: function () {
					return '<b>'+this.series.name + ': </b> ' + this.y + ' points';
				}
		    },
		    series: [
<?php
  $q = "SELECT id_user,login FROM ".get_table_users();
  $r_users=mysql_query($q) or die(mysql_error());
  $n_users=mysql_num_rows($r);
  $user_cpt = 0;
  while ($user = mysql_fetch_array($r_users)){
	$user_cpt++;
	$id_user  = $user['id_user'];
	$login  = $user['login'];
	$score = 0;
	$q = "SELECT date,points,phase,".get_table_paris().".id_match FROM ".get_table_paris().", ".get_table_matchs()."
		  WHERE id_user=$id_user AND (done=1 OR done=5) AND ".get_table_paris().".id_match=".get_table_matchs().".id_match ORDER BY date ASC";
    $r_paris=mysql_query($q) or die(mysql_error());
	echo "{ name: '$login', data: [0";
	while ($match = mysql_fetch_array($r_paris)){
	  $score += $match['points'];
	  echo ",".$score;
	}
	echo "]}";
	if($user_cpt<$n_users)
		echo ",";
  }
?>],
			legend : { enabled: false},
			credits: { enabled: false}
		});

	});

});
</script></div>

<?php } ?>



<form role="form" action="" method='post' enctype="multipart/form-data">
  <div class="form-group">
    <label for="message">Ecrire un message:</label>
    <textarea wrap='soft' name="message" id="message" cols="50" rows="5" class="form-control"></textarea>
  </div>
  <div class="form-group">
    <label for="photo">Ajouter une photo:</label>
    <input type="file" name="photo" id="photo" accept="image/*" />
  </div>
  <button type="submit" class="btn btn-default pull-right">Envoyer</button>
  <script type="text/javascript">
	CKEDITOR.replace( 'message' );
  </script>
</form>

<div class="clearfix" id="messages"></div>

<?php

$messagesParPage = 30; //Nous allons afficher 30 messages par page.
$retour_total = mysql_query("SELECT COUNT(*) AS total FROM ".get_table_messages()); //Nous récupérons le contenu de la requête dans $retour_total
$donnees_total = mysql_fetch_assoc($retour_total); //On range retour sous la forme d'un tableau.
$nombreDePages = ceil($donnees_total['total']/$messagesParPage);
$pageActuelle = isset($_GET['page'])? min(intval($_GET['page']), $nombreDePages) : 1; 
$premiereEntree=($pageActuelle-1)*$messagesParPage; // On calcul la première entrée à lire
 
$q = "SELECT * FROM ".get_table_messages()." ORDER BY date DESC LIMIT ".$premiereEntree.', '.$messagesParPage.'';
$r = mysql_query($q) or die(mysql_error());
$id_user = $_SESSION['current_ID'];
$r_user = mysql_fetch_array(mysql_query("SELECT login,privilege FROM ".get_table_users()." WHERE id_user=$id_user"));
$current_user = $r_user['login'];
$current_priv = $r_user['privilege'];
$imgs = get_photos();
while($message= mysql_fetch_array($r)){
  $text = $message['text'];
  $text = preg_replace('/  /', '&nbsp;&nbsp;', $text);
  $text = nl2br(stripslashes($text));
  $user = $message['login'];
  $likes = $message['likes'];
  $date = strftime("%A %e %b à %k:%M", strtotime($message['date']));
  //$date = date("l d/m at h:i", $message['date']);
  $id_message = $message['id_message'];
  echo "<div class='message panel panel-default'>";
  if(strlen(trim($text))>0){
	echo "<div class='panel-body'>".$text."</div>";
  }
  if(array_key_exists($id_message, $imgs)){
	echo "<img src='".$imgs[$id_message]."' class='img-responsive center-block'>";
  }
  echo "<div class='panel-footer text-right'>";
  echo "<form action='' method='post'><input type='hidden' name='like_msg' value='$id_message'>";
  echo "<button type='submit' class='btn btn-default btn-sm inline pull-left btn-msg' title='Like'>";
  echo "<span class='glyphicon glyphicon-thumbs-up'></span>";
  if($likes!=0)
	echo " (".$likes.")";
  echo "</button>";
  echo "</form>";
  if ($current_priv =='admin' || $current_user==$user){
	echo "<form action='' method='post'><input type='hidden' name='delete_msg' value='$id_message'>";
    echo "<button type='submit' class='btn btn-default btn-sm inline pull-left btn-msg' title='Supprimer'>";
    echo "<span class='glyphicon glyphicon-trash'></span>";
    echo "</button>";
	echo "</form>";
  }
  echo "<span class='inline'><b>".$user."</b> (".$date.")</span>";
  echo "</div></div>";
}

echo "<ul class=\"pagination\">"; //Pour l'affichage, on centre la liste des pages
for($i=1; $i<=$nombreDePages; $i++){ //On fait notre boucle
  echo "<li";
  if($i==$pageActuelle){
	  echo " class=\"active\"><a href=\"#messages\">".$i."</a></li>";
  }else{
	  echo "><a href=\"main_page.php?page=".$i."\">".$i."</a></li>";
  }
}
echo '</ul>';
?>
</div>

<div class='col-sm-6 col-sm-offset-3 col-md-3 col-md-offset-0 margin_down'>
	<div class="panel panel-default ">
		<div class="panel-heading">Stats</div>
<?php   // Cadran Statistiques
  $r = mysql_query("SELECT id_user FROM ".get_table_users()) or die(mysql_error());
  $n_users = mysql_num_rows($r);
  $r = mysql_query("SELECT id_pari FROM ".get_table_paris()) or die(mysql_error());
  $n_paris = mysql_num_rows($r);
  $r = mysql_query("SELECT id_match FROM ".get_table_matchs()." WHERE done=1 OR done=5") or die(mysql_error());
  $n_matchs_done = mysql_num_rows($r);
  $r = mysql_query("SELECT id_match FROM ".get_table_matchs()." WHERE done=0 OR done=3 OR done=4") or die(mysql_error());
  $n_matchs_undone = mysql_num_rows($r);
  $r = mysql_query("SELECT id_message FROM ".get_table_messages()) or die(mysql_error());
  $n_messages = mysql_num_rows($r);
  echo "<ul class=\"list-group\">";
  echo "<li class=\"list-group-item\"><b>".$n_users."</b> bouteilles dans la cave</li>";
  echo "<li class=\"list-group-item\"><b>".$n_paris."</b> pronos enregistrés</li>";
  echo "<li class=\"list-group-item\"><b>".$n_matchs_done."</b> matchs terminés</li>";
  echo "<li class=\"list-group-item\"><b>".$n_matchs_undone."</b> matchs à venir</li>";
  echo "<li class=\"list-group-item\"><b>".$n_messages."</b> messages postés</li>";
  echo "</ul>";
?>
	</div>
</div>
		
<div class="col-sm-6 col-sm-offset-3 col-md-3 col-md-offset-0">
<a class="twitter-timeline" href="https://twitter.com/EURO2024FRA?ref_src=twsrc%5Etfw">Tweets by EURO2024FRA</a> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
</div>

<?php print_html_footer(True); ?>
