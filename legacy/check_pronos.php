<?php require_once("commons.php"); ?>
<!doctype html public "-//W3C//DTD HTML 4.0 //EN">
<html>
<head>
       <title>Administration</title>
</head>
<body>
<h1>Phases finales</h1>
<?php
$q="SELECT id_user,login FROM ".get_table_users();
$r=mysql_query($q);
while($user = mysql_fetch_array($r)){
$id_user = $user['id_user'];
$q="SELECT id_pari FROM ".get_table_paris().", ".get_table_matchs()."
WHERE id_user=$id_user AND ".get_table_paris().".id_match=".get_table_matchs().".id_match AND ".get_table_matchs().".done>=3";
$r_paris=mysql_query($q);
echo $user['login'].": ".mysql_num_rows($r_paris)."<br>";
}
?>
<h1>Phases groupes</h1>
<?php
$q="SELECT id_user,login FROM ".get_table_users();
$r=mysql_query($q);
while($user = mysql_fetch_array($r)){
$id_user = $user['id_user'];
$q="SELECT id_pari FROM ".get_table_paris().", ".get_table_matchs()."
WHERE id_user=$id_user AND ".get_table_paris().".id_match=".get_table_matchs().".id_match AND ".get_table_matchs().".done=0";
$r_paris=mysql_query($q);
echo $user['login'].": ".mysql_num_rows($r_paris)."<br>";
}
?>
</body>
</html>
